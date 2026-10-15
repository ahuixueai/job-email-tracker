import { EMPTY_EXTRACTION, parseEmail } from "../../engine/src/index.js";
import type { Extraction, LLMExtractor, ParseOutcome } from "../../engine/src/index.js";
import { loadCompanyZones } from "./api.js";
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
export async function reparseBatch(env: Env, after: string | null): Promise<ReparseResult> {
  const rows = await env.DB.prepare(
    "SELECT id, from_addr, subject, body, received_at, status, outcome FROM emails WHERE status = 'parsed' AND id > ? ORDER BY id LIMIT ?",
  )
    .bind(after ?? "", BATCH)
    .all<Row>();
  const zones = await loadCompanyZones(env);
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
      { extractor: replay(extraction), lookupCompanyRegion: (company) => zones[company] ?? null },
    );
    const status = outcome.kind === "dropped" ? "dropped" : "parsed";
    if (summary(old) !== summary(outcome)) changed += 1;
    await env.DB.prepare("UPDATE emails SET outcome = ?, status = ? WHERE id = ?").bind(JSON.stringify(outcome), status, row.id).run();
  }
  const last = rows.results[rows.results.length - 1];
  return { next: rows.results.length < BATCH || !last ? null : last.id, checked: rows.results.length, changed };
}

function summary(outcome: ParseOutcome | null): string {
  if (outcome === null) return "none";
  if (outcome.kind === "dropped") return "dropped";
  return `${outcome.event.eventType}|${outcome.event.confidence}|${outcome.event.startUtc ?? ""}`;
}
