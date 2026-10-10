import type { EventType, ParsedEvent, StoredEvent } from "./types.js";
import { DUE_TYPE_PRECISION } from "./dueType.js";
import { localDateIn } from "./timezone.js";

/**
 * 去重与合并。
 *
 * baseline 报告第 2 节：30 条里约 27% 是冗余，其中有一组笔试通知
 * 系统自己在 note 里写了「重复提醒（同 08-13 16:02 内容）」却仍然存了两条。
 * 这不是解析能力问题，是架构缺失——没有合并机制。
 *
 * ATS 的重复催办本身是有用信号，应该体现为 remindCount 递增，而不是两条独立记录。
 */

export interface DedupInput {
  company: string;
  eventType: EventType;
  /** 目标日期，YYYY-MM-DD，取事件所在时区的日历日。未知时传 null。 */
  targetDate: string | null;
}

/**
 * 生成去重键：公司 + 事件类型 + 目标日期。
 *
 * 返回可读的复合键而不是哈希：这个值会进日志和排障视图，
 * 能直接看出「哪家公司的哪件事」比一串摘要有用得多，且不需要引入 crypto 依赖。
 */
export function buildDedupKey(input: DedupInput): string {
  const company = input.company.trim().toLowerCase().replace(/\s+/g, "");
  const date = input.targetDate ?? "no-date";
  return `${company}|${input.eventType}|${date}`;
}

/** 从 ParsedEvent 推出目标日期。用事件所在时区的日历日，不能用 UTC 日。 */
export function targetDateOf(event: ParsedEvent): string | null {
  if (event.startUtc === null) return null;
  if (event.sourceTimeZone === null) return event.startUtc.slice(0, 10);
  return localDateIn(event.startUtc, event.sourceTimeZone);
}

/**
 * 没有公司名时用的键前缀。**这类记录永不与任何记录合并。**
 *
 * 合并的依据是「同一家公司的同一件事」。公司名为空时这个依据根本不存在，
 * 而 `""|assessment|no-date` 这个键会把所有「认不出公司、认不出日期的测评」
 * 全部撞成一条——实测 30 封真实邮件里就有 4 封不同公司的信被并成了一条。
 * 那不是去重，是数据损坏：用户看到一条记录，点开发现里面混着四家公司。
 *
 * company.ts 对这种情况的立场是「宁可不合并，也不错合并」，这里保持一致。
 */
const NO_COMPANY = "no-company";

export function dedupKeyOf(event: ParsedEvent): string {
  if (event.company.trim().length === 0) {
    return `${NO_COMPANY}:${event.sourceRef ?? "unknown"}|${event.eventType}|${targetDateOf(event) ?? "no-date"}`;
  }
  return buildDedupKey({
    company: event.company,
    eventType: event.eventType,
    targetDate: targetDateOf(event),
  });
}

/** 首次入库：ParsedEvent → StoredEvent。 */
export function toStoredEvent(event: ParsedEvent): StoredEvent {
  return {
    dedupKey: dedupKeyOf(event),
    company: event.company,
    companyMatched: event.companyMatched,
    eventType: event.eventType,
    dueType: event.dueType,
    startUtc: event.startUtc,
    endUtc: event.endUtc,
    sourceTimeZone: event.sourceTimeZone,
    confidence: event.confidence,
    firstSeenUtc: event.receivedAtUtc,
    lastSeenUtc: event.receivedAtUtc,
    remindCount: 1,
    sourceRefs: event.sourceRef === null ? [] : [event.sourceRef],
  };
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

/**
 * 合并同一件事的新一封邮件。
 *
 * 规则：
 * - remindCount 加一（催办次数是有用信号）
 * - 精度冲突取高：fixed_start > deadline > date_only > unknown
 * - 已有 startUtc 而新的是 null 时保留旧值，绝不被覆盖成空
 * - firstSeenUtc 取最早，lastSeenUtc 取最新
 */
export function mergeEvent(existing: StoredEvent, incoming: ParsedEvent): StoredEvent {
  const oldRank = DUE_TYPE_PRECISION[existing.dueType];
  const newRank = DUE_TYPE_PRECISION[incoming.dueType];

  // 新的精度更高才换；同精度时，只有在旧值缺失而新值存在时才补上
  const takeNewTime =
    newRank > oldRank || (newRank === oldRank && existing.startUtc === null);

  // 无论精度如何，都不允许把已有时刻抹成 null
  const startUtc = takeNewTime && incoming.startUtc !== null
    ? incoming.startUtc
    : existing.startUtc;
  const endUtc = takeNewTime && incoming.startUtc !== null
    ? incoming.endUtc
    : (existing.endUtc ?? incoming.endUtc);

  const dueType = takeNewTime && incoming.startUtc !== null
    ? incoming.dueType
    : newRank > oldRank && existing.startUtc === null
      ? incoming.dueType
      : existing.dueType;

  const sourceRefs = [...existing.sourceRefs];
  if (incoming.sourceRef !== null && !sourceRefs.includes(incoming.sourceRef)) {
    sourceRefs.push(incoming.sourceRef);
  }

  return {
    ...existing,
    dueType,
    startUtc,
    endUtc,
    sourceTimeZone: existing.sourceTimeZone ?? incoming.sourceTimeZone,
    // 公司名归一化成功过就不退回去
    company: existing.companyMatched ? existing.company : incoming.company,
    companyMatched: existing.companyMatched || incoming.companyMatched,
    confidence:
      CONFIDENCE_RANK[incoming.confidence] > CONFIDENCE_RANK[existing.confidence]
        ? incoming.confidence
        : existing.confidence,
    firstSeenUtc:
      Date.parse(incoming.receivedAtUtc) < Date.parse(existing.firstSeenUtc)
        ? incoming.receivedAtUtc
        : existing.firstSeenUtc,
    lastSeenUtc:
      Date.parse(incoming.receivedAtUtc) > Date.parse(existing.lastSeenUtc)
        ? incoming.receivedAtUtc
        : existing.lastSeenUtc,
    remindCount: existing.remindCount + 1,
    sourceRefs,
  };
}

/**
 * 把一批解析结果折叠成去重后的列表。
 * 顺序无关：同 key 的先到者建档，后来者合并进去。
 */
export function foldEvents(events: readonly ParsedEvent[]): StoredEvent[] {
  const byKey = new Map<string, StoredEvent>();
  for (const event of events) {
    const key = dedupKeyOf(event);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeEvent(existing, event) : toStoredEvent(event));
  }
  return [...byKey.values()];
}
