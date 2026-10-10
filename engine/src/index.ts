/**
 * tracker-core 的公共入口。
 *
 * 阶段 1.1 是六个各自独立的逻辑模块，阶段 1.2 把它们串成一条管线：
 *
 *   RawEmail → toCleanEmail → prefilter → LLMExtractor → parseEmail → InboxStore
 *
 * 下游（1.3 的数据层、看板、提醒）只应该从这里导入，不要深引 src/ 下的具体文件。
 */

export * from "./types.js";
export * from "./rawEmail.js";
export * from "./prefilter.js";
export * from "./extract.js";
export * from "./llmExtractor.js";
export * from "./confidence.js";
export * from "./pipeline.js";
export * from "./inbox.js";

export { normalizeCompany, isSameCompany, isAtsDomain, cleanCompanyName } from "./company.js";
export { classifyEventType } from "./eventType.js";
export type { EventTypeSignals, EventTypeClassification } from "./eventType.js";
export { classifyEventFormat } from "./eventFormat.js";
export type { EventFormat, EventFormatClassification } from "./eventFormat.js";
export { extractActionInfo, extractCredentials, extractLinks } from "./actionInfo.js";
export type { ActionInfo, Credential } from "./actionInfo.js";
export { classifyDue, classifyDueFromSignals } from "./dueType.js";
export type { DueClassification } from "./dueType.js";
export { buildDedupKey, dedupKeyOf, foldEvents, mergeEvent, toStoredEvent } from "./dedup.js";
export {
  formatDual,
  inferTimeZone,
  isSameZone,
  localDateIn,
  wallClockToUtc,
  zoneAbbr,
} from "./timezone.js";
export type { DualDisplay, TimeZoneInference, TimeZoneSignals } from "./timezone.js";
