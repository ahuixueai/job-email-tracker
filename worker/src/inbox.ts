import { fastExtraBody, ModelExtractor, openAICompatibleComplete, parseEmail, StubExtractor } from "../../engine/src/index.js";
import type { LLMExtractor, ParseOutcome } from "../../engine/src/index.js";
import { admit, confirmationCode, MAX_STORED_BODY, pickBody, sentAtUtc, stripForwardPrefix, unwrapManualForward } from "./mail.js";
import type { Header } from "./mail.js";
import { effectiveForwarders, ensureOwner, inboxDomain, userByInboxToken } from "./accounts.js";
import type { User } from "./accounts.js";
import { takeAiCall } from "./ai.js";
import { looksLikeJobMail } from "./jobWords.js";
import { loadBlockedSenders, loadCompanyZones, loadPrefs } from "./store.js";
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
  /** 作为附件夹在这封信里的整封信（一次选中好几封转发时，QQ 等邮箱会这样打包）。只拆一层。 */
  attached?: readonly IncomingMail[];
}

/** 一封信里最多拆出几封夹带的信。 */
export const MAX_ATTACHED_MESSAGES = 20;

export type Handling =
  | { kind: "rejected"; reason: string }
  | { kind: "duplicate" }
  | { kind: "notice" }
  | { kind: "stored"; status: "parsed" | "dropped" | "error" | "self" }
  | { kind: "split"; results: Handling[] }
  /** 自动转发来的、不像招聘信的（邮箱里设了「全部转发」时的私人邮件）：直接丢掉，不存、不交给 AI。 */
  | { kind: "skipped" };

/** 「名字 <a@b>」或光秃秃的地址里取出邮箱地址（小写）；认不出为空串。 */
function addressOf(from: string): string {
  return (/<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? /([^\s<>"]+@[^\s<>"]+)/.exec(from)?.[1] ?? "").toLowerCase();
}

/** 看板自己发信用的地址（验证码、监控提醒、邮件提醒）。 */
export function systemSender(env: Env): string {
  return (env.LOGIN_FROM && env.LOGIN_FROM.includes("@") ? env.LOGIN_FROM : "login@interviewtrack.me").toLowerCase();
}

/** 模型调用的单次超时。邮件处理没有人在等，给足但别无限等。 */
const MODEL_TIMEOUT_MS = 25_000;

export function extractorFor(env: Env, onError: (message: string) => void): { extractor: LLMExtractor; model: string | null } {
  const { LLM_API_KEY: apiKey, LLM_BASE_URL: baseUrl, LLM_MODEL: model } = env;
  if (!apiKey || !baseUrl || !model) return { extractor: new StubExtractor(), model: null };
  const extraBody = fastExtraBody(baseUrl);
  const complete = openAICompatibleComplete({
    baseUrl,
    apiKey,
    model,
    // 只摘片段，不需要模型深度思考（DeepSeek 默认开着，常常超时）
    ...(extraBody ? { extraBody } : {}),
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
 * 这次要不要用 AI：没配模型、这个人关掉了、今天额度用完 → 纯规则（并说明原因）。
 * 能用就记一次用量。
 */
export async function extractorForUser(
  env: Env,
  user: User,
  nowMs: number,
  onError: (message: string) => void,
): Promise<{ extractor: LLMExtractor; model: string | null; note: string | null }> {
  const configured = extractorFor(env, onError);
  if (configured.model === null) return { ...configured, note: null };
  const gate = await takeAiCall(env, user, nowMs);
  if (!gate.ok) return { extractor: new StubExtractor(), model: null, note: gate.note };
  return { ...configured, note: null };
}

/**
 * 标题像「开通自动转发的确认信」（QQ：「QQ邮箱自动转发验证邮件」）。
 * 要求说的是「自动转发 / 转发验证 / 转发确认」这类词组，免得「请确认面试时间（请勿转发）」这种招聘信被误认。
 */
export function looksLikeForwardingVerification(subject: string): boolean {
  return /自动转发|转发(验证|确认|激活)|(验证|确认)转发|forwarding (verification|confirmation)|(verify|confirm)\w* (your )?forwarding/i.test(subject);
}

const domainOf = (value: string): string | null => /@([a-z0-9.-]+)/i.exec(value)?.[1]?.toLowerCase() ?? null;

/** 被拒收的信的诊断信息：域名、是否带 Gmail 的转发标记、有哪些头（只要名字）。不含正文和完整地址。 */
export function rejectionDiag(mail: IncomingMail, reason: string): Record<string, unknown> {
  const names = [...new Set(mail.headers.map((h) => h.key.toLowerCase()))].slice(0, 60);
  return {
    reason,
    envelopeFromDomain: domainOf(mail.envelopeFrom),
    fromDomain: domainOf(mail.from),
    hasXForwardedFor: names.includes("x-forwarded-for"),
    headerNames: names,
    // 只有像系统确认信的标题才记，普通信的标题不记
    ...(looksLikeForwardingVerification(mail.subject) ? { subject: mail.subject.slice(0, 80) } : {}),
  };
}

/**
 * 这封信是寄给谁的：jobs@ = 作者（老地址，Gmail 过滤器不用改）；u-口令@ = 对应的那个人。
 * 别的地址（有人乱猜）一律不认。
 */
export async function recipientOf(env: Env, envelopeTo: string, nowMs: number): Promise<User | null> {
  const address = envelopeTo.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 0 || address.slice(at + 1) !== inboxDomain(env)) return null;
  const local = address.slice(0, at);
  if (local === "jobs") return ensureOwner(env, nowMs);
  const match = /^u-([a-z0-9]{10})$/.exec(local);
  return match ? userByInboxToken(env, match[1] ?? "") : null;
}

/**
 * 处理一封收到的信：认收件人 → 认转发人 → 去重 → 拆手动转发 → 解析 → 存库。
 *
 * 任何一步出错都**照样存下来**（status = error），只是没有解析结论——
 * 邮件丢了用户永远不知道，存下来至少能在看板上看到「这封没处理好」。
 */
export async function handleIncoming(
  mail: IncomingMail,
  env: Env,
  nowMs: number,
  newId: () => string,
  /** 外层那封信已经认过人了（拆出来的夹带信用）：不再按发件人认，按手动转发处理。 */
  admittedVia?: "auto" | "manual",
): Promise<Handling> {
  const user = await recipientOf(env, mail.envelopeTo, nowMs);
  if (user === null) return { kind: "rejected", reason: "没有这个收信地址" };
  const allow = effectiveForwarders(env, user);
  const verdict = admittedVia ? ({ kind: "job", via: admittedVia } as const) : admit(mail.envelopeFrom, mail.from, mail.headers, allow);
  if (verdict.kind === "reject") {
    // 诊断：其他邮箱（QQ 等）转发过来的信长什么样。只记域名、有没有转发标记、头的名字，不记正文
    console.log(JSON.stringify({ inboxDiag: rejectionDiag(mail, verdict.reason) }));
    // 别的邮箱服务开通转发时发来的确认信（QQ 邮箱要先在收信地址这边确认）：先存成提醒，不丢
    if (looksLikeForwardingVerification(mail.subject)) {
      const body = pickBody(mail.text, mail.html).slice(0, MAX_STORED_BODY);
      await env.DB.prepare("INSERT INTO notices (id, user_id, kind, received_at, subject, body) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(newId(), user.id, "forward-verify", sentAtUtc(mail.date, nowMs), mail.subject, `发件人：${mail.from}\n\n${body}`)
        .run();
      return { kind: "notice" };
    }
    return { kind: "rejected", reason: verdict.reason };
  }

  let body = pickBody(mail.text, mail.html);
  const receivedAt = sentAtUtc(mail.date, nowMs);

  if (verdict.kind === "gmail-forwarding-confirmation") {
    const code = confirmationCode(`${mail.subject}\n${body}`);
    await env.DB.prepare("INSERT INTO notices (id, user_id, kind, received_at, subject, body) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(newId(), user.id, "gmail-forwarding", receivedAt, mail.subject, code ? `验证码：${code}\n\n${body}` : body)
      .run();
    return { kind: "notice" };
  }

  // 别的邮箱（QQ 等）开通自动转发的确认信：它以你自己的邮箱名义发来，单独存成提醒，看板上放在「邮箱转发确认」里
  if (looksLikeForwardingVerification(mail.subject) && allow.some((address) => mail.from.toLowerCase().includes(address))) {
    await env.DB.prepare("INSERT INTO notices (id, user_id, kind, received_at, subject, body) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(newId(), user.id, "forward-verify", receivedAt, mail.subject, `发件人：${mail.from}\n\n${body.slice(0, MAX_STORED_BODY)}`)
      .run();
    return { kind: "notice" };
  }

  // 一次转发好几封：外层几乎没有正文，原信都夹在附件里。拆开，每封按原信单独处理（收信时刻用原信的时间）
  if (!admittedVia && mail.attached && mail.attached.length > 0 && pickBody(mail.text, mail.html).trim().length < 300) {
    const results: Handling[] = [];
    for (const inner of mail.attached.slice(0, MAX_ATTACHED_MESSAGES)) {
      const { attached: _nested, ...one } = inner;
      results.push(await handleIncoming({ ...one, envelopeFrom: mail.envelopeFrom, envelopeTo: mail.envelopeTo, headers: [] }, env, nowMs, newId, "manual"));
    }
    return { kind: "split", results };
  }

  // 准点自己发的信（登录验证码、监控提醒、邮件提醒）被你的邮箱转回来：直接丢掉，不存
  if (addressOf(mail.from) === systemSender(env)) return { kind: "skipped" };

  // 邮箱里设了「全部转发」：私人邮件也会过来。不像招聘信的直接丢掉——不存、不交给 AI、不扣额度。
  // 手动转发的不挑：那是你自己点的。
  if (verdict.via === "auto" && !looksLikeJobMail({ from: mail.from, subject: mail.subject, body })) return { kind: "skipped" };

  if (mail.messageId) {
    const seen = await env.DB.prepare("SELECT id FROM emails WHERE user_id = ? AND message_id = ?").bind(user.id, mail.messageId).first();
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
      ownMessage = allow.some((address) => mail.from.toLowerCase().includes(address));
    }
  }
  body = body.slice(0, MAX_STORED_BODY);

  const id = newId();
  if (ownMessage) {
    await env.DB.prepare(
      `INSERT INTO emails (id, user_id, message_id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, user.id, mail.messageId ?? null, receivedAt, new Date(nowMs).toISOString(), "self", from, subject, body, "self", null, null, null)
      .run();
    return { kind: "stored", status: "self" };
  }

  // 你在看板上标成广告的发件人：存档可查，但不解析、不调模型
  const address = addressOf(from);
  if (address.length > 0 && (await loadBlockedSenders(env, user.id)).includes(address)) {
    await env.DB.prepare(
      `INSERT INTO emails (id, user_id, message_id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        user.id,
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
    user,
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
async function parseAndStore(mail: ReadyMail, env: Env, user: User, nowMs: number): Promise<"parsed" | "dropped" | "error"> {
  let modelError: string | null = null;
  let outcome: ParseOutcome | null = null;
  let failure: string | null = null;
  const { extractor, model, note } = await extractorForUser(env, user, nowMs, (message) => {
    modelError = message;
  });
  try {
    // 你在看板上确认过的「这家公司按哪个时区」、你设置的求职地，当作时区线索喂给引擎
    const zones = await loadCompanyZones(env, user.id);
    const jobTimeZone = (await loadPrefs(env, user.id)).timeZones.job;
    outcome = await parseEmail(
      { id: mail.id, from: mail.from, to: mail.to, subject: mail.subject, body: mail.body, receivedAtUtc: mail.receivedAt },
      { extractor, lookupCompanyRegion: (company) => zones[company] ?? null, jobTimeZone },
    );
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const status = outcome === null ? "error" : outcome.kind === "dropped" ? "dropped" : "parsed";
  // 模型失败不算整封失败：引擎会退回纯规则，但要把原因记下来
  // AI 关掉了、额度用完了：不算失败，但写明原因
  const error = failure ?? (modelError !== null ? `模型调用失败，已退回纯规则：${modelError}` : note);
  await env.DB.prepare(
    `INSERT INTO emails (id, user_id, message_id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      mail.id,
      user.id,
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
export async function importEmail(item: ImportedMail, env: Env, user: User, nowMs: number, newId: () => string): Promise<ImportResult> {
  const receivedMs = Date.parse(item.receivedAtUtc);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(item.receivedAtUtc) || !Number.isFinite(receivedMs)) {
    return { kind: "invalid", reason: "缺少原信的发信时刻（UTC），不导入——相对期限会算错" };
  }
  if (item.from.trim().length === 0 && item.subject.trim().length === 0) return { kind: "invalid", reason: "发件人和主题都是空的" };

  const receivedAt = new Date(receivedMs).toISOString();
  const key = `import:${await sha256Hex(`${item.from}\n${receivedAt}\n${item.subject}`)}`;
  const seen = await env.DB.prepare("SELECT id FROM emails WHERE user_id = ? AND message_id = ?").bind(user.id, key).first();
  if (seen) return { kind: "duplicate" };

  const id = newId();
  const body = item.body.slice(0, MAX_STORED_BODY);
  const allow = effectiveForwarders(env, user);
  if (allow.some((address) => item.from.toLowerCase().includes(address))) {
    await env.DB.prepare(
      `INSERT INTO emails (id, user_id, message_id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, user.id, key, receivedAt, new Date(nowMs).toISOString(), "self", item.from, item.subject, body, "self", null, null, null)
      .run();
    return { kind: "stored", status: "self" };
  }
  const status = await parseAndStore({ id, messageId: key, receivedAt, via: "import", from: item.from, to: "", subject: item.subject, body }, env, user, nowMs);
  return { kind: "stored", status };
}
