// 生成物：由 scripts/sync-tracker-core.mjs 从 engine/src 同步而来，不要手改。
/**
 * tracker-core 的公共入口。
 *
 * 阶段 1.1 是六个各自独立的逻辑模块，阶段 1.2 把它们串成一条管线：
 *
 *   RawEmail → toCleanEmail → prefilter → LLMExtractor → parseEmail → InboxStore
 *
 * 下游（1.3 的数据层、看板、提醒）只应该从这里导入，不要深引 src/ 下的具体文件。
 */

export * from "./types";
export * from "./rawEmail";
export * from "./prefilter";
export * from "./extract";
export * from "./llmExtractor";
export * from "./confidence";
export * from "./pipeline";
export * from "./inbox";

export { normalizeCompany, isSameCompany, isAtsDomain, cleanCompanyName } from "./company";
export { classifyEventType } from "./eventType";
export type { EventTypeSignals, EventTypeClassification } from "./eventType";
export { classifyEventFormat } from "./eventFormat";
export type { EventFormat, EventFormatClassification } from "./eventFormat";
export { extractActionInfo, extractCredentials, extractLinks } from "./actionInfo";
export type { ActionInfo, Credential } from "./actionInfo";
export { classifyDue, classifyDueFromSignals } from "./dueType";
export type { DueClassification } from "./dueType";
export { buildDedupKey, dedupKeyOf, foldEvents, mergeEvent, toStoredEvent } from "./dedup";
export {
  formatDual,
  inferTimeZone,
  isSameZone,
  localDateIn,
  wallClockToUtc,
  zoneAbbr,
} from "./timezone";
export type { DualDisplay, TimeZoneInference, TimeZoneSignals } from "./timezone";
