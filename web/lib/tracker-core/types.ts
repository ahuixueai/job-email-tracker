// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
/**
 * 核心数据模型。
 *
 * 时间铁律（来自方案 v0.2 第 6.2 节）：
 * 1. 一律以 UTC ISO 8601 存储，字段名以 Utc 结尾
 * 2. 事件所在地的时区单独存 IANA 名，绝不丢失
 * 3. 任何地方都不出现不带时区信息的本地时间字符串
 */

/** UTC ISO 8601 字符串，如 "2026-08-15T02:00:00.000Z"。 */
export type UtcIsoString = string;

/** IANA 时区名，如 "Asia/Shanghai"。 */
export type IanaTimeZone = string;

/**
 * 时间语义。把这四种塞进同一个字段是 baseline 报告第 1 节记录的致命缺陷：
 * 把 deadline 渲染成「10:00 开始」只是让用户空等，
 * 把 fixed_start 渲染成「18 号前完成」会让用户彻底错过考试。
 */
export type DueType =
  /** 固定开始时刻，迟到即失去资格（笔试开考、面试场次） */
  | "fixed_start"
  /** 截止期限，在此之前完成即可（72 小时内完成测评） */
  | "deadline"
  /** 只有日期没有钟点 */
  | "date_only"
  /** 完全没有时间信息。startUtc 必须为 null，禁止凭空生成钟点 */
  | "unknown";

export type EventType =
  /** 投递成功 / 已收到简历 */
  | "application_ok"
  /** 在线测评、笔试、OA */
  | "assessment"
  /** 各类面试，含 AI 面 */
  | "interview"
  /** 结果通知：通过、婉拒、offer */
  | "result"
  /** 催办、重复提醒 */
  | "reminder"
  /** 流程更新：补充简历、信息变更 */
  | "update"
  /** 其他，含非求职噪音 */
  | "other";

/**
 * 置信度。低置信不进主看板、不触发提醒（方案 v0.2 第 4.3 节）。
 */
export type Confidence = "high" | "medium" | "low";

/** 解析层的输出，尚未入库。 */
export interface ParsedEvent {
  /** 归一化后的公司名。归一失败时是清洗过的原名。 */
  company: string;
  /** 公司名是否命中别名表。false 表示没把握，不要用它做跨记录合并的强依据。 */
  companyMatched: boolean;
  eventType: EventType;
  dueType: DueType;
  /** 事件时刻或截止时刻（UTC）。dueType 为 unknown 时必须是 null。 */
  startUtc: UtcIsoString | null;
  /** 有明确结束时刻才填，如「10:00-11:40」。 */
  endUtc: UtcIsoString | null;
  /** 事件所在地时区。推断不出时为 null，此时不得渲染双时区。 */
  sourceTimeZone: IanaTimeZone | null;
  confidence: Confidence;
  /** 邮件的收信时刻（UTC），相对期限从它起算。 */
  receivedAtUtc: UtcIsoString;
  /** 原始来源标识，用于回溯，如 inbox_events 的 id。 */
  sourceRef: string | null;
}

/** 入库形态。在 ParsedEvent 基础上加去重与审计字段。 */
export interface StoredEvent {
  /** 公司 + 事件类型 + 目标日期 的归一化键，同键即同一件事。 */
  dedupKey: string;
  company: string;
  companyMatched: boolean;
  eventType: EventType;
  dueType: DueType;
  startUtc: UtcIsoString | null;
  endUtc: UtcIsoString | null;
  sourceTimeZone: IanaTimeZone | null;
  confidence: Confidence;
  /** 首次见到这件事的时刻，合并时保留最早的。 */
  firstSeenUtc: UtcIsoString;
  /** 最近一次收到相关邮件的时刻，合并时取最新的。 */
  lastSeenUtc: UtcIsoString;
  /**
   * 收到过几封描述同一件事的邮件。
   * ATS 的重复催办是有用信号，应体现为计数递增而不是新增记录。
   */
  remindCount: number;
  /** 参与过合并的所有来源标识。 */
  sourceRefs: string[];
}

/**
 * 以下是运行时用得到的枚举清单与守卫。
 *
 * 解析层的上游是 LLM，它随时可能吐出 "assessments"、"Interview"、"OA" 这类
 * 不在枚举内的值。在边界上挡掉比让脏值流进数据层再排查便宜得多。
 */

export const DUE_TYPES: readonly DueType[] = [
  "fixed_start",
  "deadline",
  "date_only",
  "unknown",
];

export const EVENT_TYPES: readonly EventType[] = [
  "application_ok",
  "assessment",
  "interview",
  "result",
  "reminder",
  "update",
  "other",
];

export const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];

export function isDueType(value: unknown): value is DueType {
  return typeof value === "string" && (DUE_TYPES as readonly string[]).includes(value);
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

export function isConfidence(value: unknown): value is Confidence {
  return typeof value === "string" && (CONFIDENCES as readonly string[]).includes(value);
}

/** 不认识的事件类型一律落到 other，不猜也不丢。 */
export function coerceEventType(value: unknown): EventType {
  return isEventType(value) ? value : "other";
}

/** 不认识的置信度一律按最低处理，宁可降级也不误升。 */
export function coerceConfidence(value: unknown): Confidence {
  return isConfidence(value) ? value : "low";
}

/**
 * 结构性不变量：dueType 为 unknown 时 startUtc 必须为 null。
 * 这是方案 v0.2 第 4.3 节的硬性要求，入库前应当断言。
 */
export function isConsistentDue(
  dueType: DueType,
  startUtc: UtcIsoString | null,
): boolean {
  if (dueType === "unknown") return startUtc === null;
  return true;
}
