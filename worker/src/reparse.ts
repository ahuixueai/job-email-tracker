import { EMPTY_EXTRACTION, parseEmail } from "../../engine/src/index.js";
import type { Extraction, LLMExtractor, ParseOutcome } from "../../engine/src/index.js";
import type { User } from "./accounts.js";
import { extractorForUser } from "./inbox.js";
import { loadCompanyZones, loadPrefs } from "./store.js";
import type { Env } from "./types.js";

/**
 * 引擎规则改进后，把已经存下的邮件按新规则重判一遍。
 *
 * **不再调用模型**：用收信时模型摘下的那份（存在 outcome.trace.extraction 里）回放，
 * 所以重判不花钱、结果可复现；变的只有规则那一半。
 * 免费套餐每次请求只有 10 毫秒 CPU，所以分批：一次最多 BATCH 封，调用方拿着 next 接着要。
 */
export const BATCH = 10;

interface Row {
  id: string;
  from_addr: string;
  subject: string;
  body: string;
  received_at: string;
  status: string;
  outcome: string | null;
}

function replay(extraction: Extraction): LLMExtractor {
  return { extract: async () => extraction };
}

export interface ReparseResult {
  /** 下一批从哪封之后开始；null = 全部做完。 */
  next: string | null;
  checked: number;
  /** 去向（日程 / 待确认 / 折叠）或类型变了的封数。 */
  changed: number;
}

/** 只重判「解析过的」：丢弃的（验证码等）预筛没变；你自己发的、出错的没有可回放的东西。 */
export async function reparseBatch(env: Env, userId: string, after: string | null): Promise<ReparseResult> {
  const rows = await env.DB.prepare(
    "SELECT id, from_addr, subject, body, received_at, status, outcome FROM emails WHERE user_id = ? AND status = 'parsed' AND id > ? ORDER BY id LIMIT ?",
  )
    .bind(userId, after ?? "", BATCH)
    .all<Row>();
  const zones = await loadCompanyZones(env, userId);
  const jobTimeZone = (await loadPrefs(env, userId)).timeZones.job;
  let changed = 0;
  for (const row of rows.results) {
    let old: ParseOutcome | null = null;
    try {
      old = row.outcome === null ? null : (JSON.parse(row.outcome) as ParseOutcome);
    } catch {
      old = null;
    }
    const extraction = old !== null && old.kind !== "dropped" ? old.trace.extraction : EMPTY_EXTRACTION;
    const outcome = await parseEmail(
      { id: row.id, from: row.from_addr, to: "", subject: row.subject, body: row.body, receivedAtUtc: row.received_at },
      { extractor: replay(extraction), lookupCompanyRegion: (company) => zones[company] ?? null, jobTimeZone },
    );
    const status = outcome.kind === "dropped" ? "dropped" : "parsed";
    if (summary(old) !== summary(outcome)) changed += 1;
    await env.DB.prepare("UPDATE emails SET outcome = ?, status = ? WHERE id = ? AND user_id = ?").bind(JSON.stringify(outcome), status, row.id, userId).run();
  }
  const last = rows.results[rows.results.length - 1];
  return { next: rows.results.length < BATCH || !last ? null : last.id, checked: rows.results.length, changed };
}

function summary(outcome: ParseOutcome | null): string {
  if (outcome === null) return "none";
  if (outcome.kind === "dropped") return "dropped";
  return `${outcome.event.company}|${outcome.event.eventType}|${outcome.event.confidence}|${outcome.event.startUtc ?? ""}`;
}

/** 收信时模型超时 / 出错、只用了规则的信，在 error 列里以这句开头（见 inbox.ts）。 */
export const MODEL_FAILED_PREFIX = "模型调用失败";
/** 一次请求最多重试几封：每封可能要等模型十几秒，批次小一点，页面上的进度也走得动。 */
export const RETRY_BATCH = 3;

export interface RetryResult extends ReparseResult {
  /** 这次重试仍然失败的封数。 */
  failed: number;
}

/**
 * 收信时模型没响应的那几封：这次**真的调用模型**重新摘一遍（花这几封的钱），再按现在的规则判。
 * 只动这些信；模型这次还失败就照旧留着规则的结论，错误原因更新成这一次的。
 */
export async function retryModelBatch(env: Env, user: User, after: string | null, nowMs: number): Promise<RetryResult> {
  const rows = await env.DB.prepare(
    `SELECT id, from_addr, subject, body, received_at, status, outcome FROM emails WHERE user_id = ? AND status = 'parsed' AND error LIKE '${MODEL_FAILED_PREFIX}%' AND id > ? ORDER BY id LIMIT ?`,
  )
    .bind(user.id, after ?? "", RETRY_BATCH)
    .all<Row>();
  const zones = await loadCompanyZones(env, user.id);
  const jobTimeZone = (await loadPrefs(env, user.id)).timeZones.job;
  let changed = 0;
  let failed = 0;
  for (const row of rows.results) {
    let old: ParseOutcome | null = null;
    try {
      old = row.outcome === null ? null : (JSON.parse(row.outcome) as ParseOutcome);
    } catch {
      old = null;
    }
    let modelError: string | null = null;
    const { extractor, model, note } = await extractorForUser(env, user, nowMs, (message) => {
      modelError = message;
    });
    const outcome = await parseEmail(
      { id: row.id, from: row.from_addr, to: "", subject: row.subject, body: row.body, receivedAtUtc: row.received_at },
      { extractor, lookupCompanyRegion: (company) => zones[company] ?? null, jobTimeZone },
    );
    const status = outcome.kind === "dropped" ? "dropped" : "parsed";
    if (summary(old) !== summary(outcome)) changed += 1;
    if (modelError !== null || (model === null && note === null)) failed += 1;
    // AI 关掉 / 额度用完（note）：不算失败，写明原因，之后也不会再进重试
    await env.DB.prepare("UPDATE emails SET outcome = ?, status = ?, model = ?, error = ? WHERE id = ? AND user_id = ?")
      .bind(
        JSON.stringify(outcome),
        status,
        modelError === null ? model : null,
        modelError !== null
          ? `${MODEL_FAILED_PREFIX}，已退回纯规则：${modelError}`
          : note !== null
            ? note
            : model === null
              ? `${MODEL_FAILED_PREFIX}，已退回纯规则：没有配置模型`
              : null,
        row.id,
        user.id,
      )
      .run();
  }
  const last = rows.results[rows.results.length - 1];
  return { next: rows.results.length < RETRY_BATCH || !last ? null : last.id, checked: rows.results.length, changed, failed };
}
