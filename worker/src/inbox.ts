import { ModelExtractor, openAICompatibleComplete, parseEmail, StubExtractor } from "../../engine/src/index.js";
import type { LLMExtractor, ParseOutcome } from "../../engine/src/index.js";
import {
  admit,
  confirmationCode,
  MAX_STORED_BODY,
  parseAllowList,
  pickBody,
  sentAtUtc,
  stripForwardPrefix,
  unwrapManualForward,
} from "./mail.js";
import type { Header } from "./mail.js";
import { loadBlockedSenders, loadCompanyZones } from "./api.js";
import type { Env } from "./types.js";

/** 拆好的一封信，与 MIME 解析库解耦，方便测试直接构造。 */
export interface IncomingMail {
  envelopeFrom: string;
  envelopeTo: string;
  headers: readonly Header[];
  /** `显示名 <地址>` 形式的发件人头。 */
  from: string;
  subject: string;
  text: string | undefined;
  html: string | undefined;
  date: string | undefined;
  messageId: string | undefined;
}

export type Handling =
  | { kind: "rejected"; reason: string }
  | { kind: "duplicate" }
  | { kind: "notice" }
  | { kind: "stored"; status: "parsed" | "dropped" | "error" | "self" };

/** 模型调用的单次超时。邮件处理没有人在等，给足但别无限等。 */
const MODEL_TIMEOUT_MS = 25_000;

function extractorFor(env: Env, onError: (message: string) => void): { extractor: LLMExtractor; model: string | null } {
  const { LLM_API_KEY: apiKey, LLM_BASE_URL: baseUrl, LLM_MODEL: model } = env;
  if (!apiKey || !baseUrl || !model) return { extractor: new StubExtractor(), model: null };
  const complete = openAICompatibleComplete({
    baseUrl,
    apiKey,
    model,
    // Workers 里把 fetch 单独拿出来调用会丢掉 this，报 Illegal invocation，所以包一层
    fetchImpl: (url, init) => fetch(url, init),
  });
  return {
    extractor: new ModelExtractor({
      complete,
      timeoutMs: MODEL_TIMEOUT_MS,
      onError: (error) => onError(error instanceof Error ? error.message : String(error)),
    }),
    model,
  };
}

/**
 * 处理一封收到的信：认人 → 去重 → 拆手动转发 → 解析 → 存库。
 *
 * 任何一步出错都**照样存下来**（status = error），只是没有解析结论——
 * 邮件丢了用户永远不知道，存下来至少能在看板上看到「这封没处理好」。
 */
export async function handleIncoming(mail: IncomingMail, env: Env, nowMs: number, newId: () => string): Promise<Handling> {
  const verdict = admit(mail.envelopeFrom, mail.from, mail.headers, parseAllowList(env.ALLOWED_FORWARDERS));
  if (verdict.kind === "reject") return { kind: "rejected", reason: verdict.reason };

  let body = pickBody(mail.text, mail.html);
  const receivedAt = sentAtUtc(mail.date, nowMs);

  if (verdict.kind === "gmail-forwarding-confirmation") {
    const code = confirmationCode(`${mail.subject}\n${body}`);
    await env.DB.prepare("INSERT INTO notices (id, kind, received_at, subject, body) VALUES (?, ?, ?, ?, ?)")
      .bind(newId(), "gmail-forwarding", receivedAt, mail.subject, code ? `验证码：${code}\n\n${body}` : body)
      .run();
    return { kind: "notice" };
  }

  if (mail.messageId) {
    const seen = await env.DB.prepare("SELECT id FROM emails WHERE message_id = ?").bind(mail.messageId).first();
    if (seen) return { kind: "duplicate" };
  }

  let from = mail.from;
  let subject = mail.subject;
  /**
   * 你自己写的信：不是转发，发件人就是你（比如回复 HR 时抄送了收信地址，或者转发了自己发出的那条）。
   * 它不是一件新的事，存下来供查看，但不解析、不调模型。
   */
  let ownMessage = false;
  if (verdict.via === "manual") {
    const original = unwrapManualForward(body);
    if (original) {
      from = original.from.length > 0 ? original.from : from;
      subject = original.subject.length > 0 ? original.subject : stripForwardPrefix(subject);
      body = original.body;
    } else {
      subject = stripForwardPrefix(subject);
      const allow = parseAllowList(env.ALLOWED_FORWARDERS);
      ownMessage = allow.some((address) => mail.from.toLowerCase().includes(address));
    }
  }
  body = body.slice(0, MAX_STORED_BODY);

  const id = newId();
  if (ownMessage) {
    await env.DB.prepare(
      `INSERT INTO emails (id, message_id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, mail.messageId ?? null, receivedAt, new Date(nowMs).toISOString(), "self", from, subject, body, "self", null, null, null)
      .run();
    return { kind: "stored", status: "self" };
  }

  // 你在看板上标成广告的发件人：存档可查，但不解析、不调模型
  const address = (/<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? /([^\s<>"]+@[^\s<>"]+)/.exec(from)?.[1] ?? "").toLowerCase();
  if (address.length > 0 && (await loadBlockedSenders(env)).includes(address)) {
    await env.DB.prepare(
      `INSERT INTO emails (id, message_id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        mail.messageId ?? null,
        receivedAt,
        new Date(nowMs).toISOString(),
        verdict.via,
        from,
        subject,
        body,
        "dropped",
        JSON.stringify({ kind: "dropped", reason: `你把 ${address} 标成了广告` }),
        null,
        null,
      )
      .run();
    return { kind: "stored", status: "dropped" };
  }

  const status = await parseAndStore(
    { id, messageId: mail.messageId ?? null, receivedAt, via: verdict.via, from, to: mail.envelopeTo, subject, body },
    env,
    nowMs,
  );
  return { kind: "stored", status };
}

/** 一封已经认完人、拆完信、准备解析的信。 */
interface ReadyMail {
  id: string;
  messageId: string | null;
  receivedAt: string;
  via: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}

/** 解析（规则 + 模型）并存库。收信和导入旧邮件共用这一段，保证两条路的结论完全一致。 */
async function parseAndStore(mail: ReadyMail, env: Env, nowMs: number): Promise<"parsed" | "dropped" | "error"> {
  let modelError: string | null = null;
  let outcome: ParseOutcome | null = null;
  let failure: string | null = null;
  const { extractor, model } = extractorFor(env, (message) => {
    modelError = message;
  });
  try {
    // 你在看板上确认过的「这家公司按哪个时区」，当作时区线索喂给引擎
    const zones = await loadCompanyZones(env);
    outcome = await parseEmail(
      { id: mail.id, from: mail.from, to: mail.to, subject: mail.subject, body: mail.body, receivedAtUtc: mail.receivedAt },
      { extractor, lookupCompanyRegion: (company) => zones[company] ?? null },
    );
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const status = outcome === null ? "error" : outcome.kind === "dropped" ? "dropped" : "parsed";
  // 模型失败不算整封失败：引擎会退回纯规则，但要把原因记下来
  const error = failure ?? (modelError !== null ? `模型调用失败，已退回纯规则：${modelError}` : null);
  await env.DB.prepare(
    `INSERT INTO emails (id, message_id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      mail.id,
      mail.messageId,
      mail.receivedAt,
      new Date(nowMs).toISOString(),
      mail.via,
      mail.from,
      mail.subject,
      mail.body,
      status,
      outcome === null ? null : JSON.stringify(outcome),
      modelError === null ? model : null,
      error,
    )
    .run();
  return status;
}

/** 从 Gmail 导出的一封旧邮件（scripts/gmail_scan.py scan 的输出格式）。 */
export interface ImportedMail {
  from: string;
  subject: string;
  body: string;
  /** 原信的发信时刻（UTC）。没有就不收——不猜时间。 */
  receivedAtUtc: string;
}

export type ImportResult = { kind: "invalid"; reason: string } | { kind: "duplicate" } | { kind: "stored"; status: "parsed" | "dropped" | "error" | "self" };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 导入一封旧邮件：和收信走同一条解析路，只是不经过「认人」（调用方已登录看板）。
 *
 * - 收信时刻用原信的 Date（UTC），所以「72 小时内」之类的相对期限按原信算，统计里的周分布也对。
 * - 去重键 = 发件人 + 原信时刻 + 主题的哈希。同一份导出跑两遍不会重复入库。
 * - 发件人是你自己（允许转发列表里的地址）→ 只存档，和收信时一样。
 */
export async function importEmail(item: ImportedMail, env: Env, nowMs: number, newId: () => string): Promise<ImportResult> {
  const receivedMs = Date.parse(item.receivedAtUtc);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(item.receivedAtUtc) || !Number.isFinite(receivedMs)) {
    return { kind: "invalid", reason: "缺少原信的发信时刻（UTC），不导入——相对期限会算错" };
  }
  if (item.from.trim().length === 0 && item.subject.trim().length === 0) return { kind: "invalid", reason: "发件人和主题都是空的" };

  const receivedAt = new Date(receivedMs).toISOString();
  const key = `import:${await sha256Hex(`${item.from}\n${receivedAt}\n${item.subject}`)}`;
  const seen = await env.DB.prepare("SELECT id FROM emails WHERE message_id = ?").bind(key).first();
  if (seen) return { kind: "duplicate" };

  const id = newId();
  const body = item.body.slice(0, MAX_STORED_BODY);
  const allow = parseAllowList(env.ALLOWED_FORWARDERS);
  if (allow.some((address) => item.from.toLowerCase().includes(address))) {
    await env.DB.prepare(
      `INSERT INTO emails (id, message_id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, key, receivedAt, new Date(nowMs).toISOString(), "self", item.from, item.subject, body, "self", null, null, null)
      .run();
    return { kind: "stored", status: "self" };
  }
  const status = await parseAndStore({ id, messageId: key, receivedAt, via: "import", from: item.from, to: "", subject: item.subject, body }, env, nowMs);
  return { kind: "stored", status };
}
