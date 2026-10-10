// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
import type { Confidence, EventType, ParsedEvent, StoredEvent, UtcIsoString } from "./types";
import { buildDedupKey, dedupKeyOf, mergeEvent, toStoredEvent } from "./dedup";
import { localDateIn } from "./timezone";
import type { ParseOutcome } from "./pipeline";

/**
 * 置信度路由与待确认收件箱。
 *
 * 方案 v0.2 第 4.3 节：「不确定必须可见，且是一等公民」。这句话的实现就是
 * 本模块——低置信结果不是被丢掉，也不是混在主看板里冒充确定信息，
 * 而是进一个用户会主动去看、点一下就能确认或纠正的地方。
 */

export type Destination =
  /** 主看板：可以据此提醒、可以进日历。 */
  | "board"
  /** 待确认收件箱：信息存在但不敢用，等用户一键确认。 */
  | "pending"
  /** 噪音：默认折叠，但**不删除**，随时可展开复查。 */
  | "noise";

export interface Routing {
  destination: Destination;
  reasons: readonly string[];
}

/**
 * 路由规则。
 *
 * high / medium → 主看板
 * low + 认得出是什么事 → 待确认收件箱
 * low + 连是什么事都认不出 → 噪音
 *
 * 最后一条是有代价的取舍，写在这里以便日后回头算账：一封真实的招聘邮件如果
 * 既没命中任何事件类型信号、模型也没给出建议，它会落进默认折叠的噪音区，
 * 用户不主动展开就看不到。之所以还是这么定，是因为待确认收件箱只有在
 * **用户真的会去看**的时候才有价值；把所有 low 都倒进去，它会迅速变成
 * 一个几百条的列表，然后没人再打开它——那时候「可见」就只是名义上的。
 *
 * 噪音区不删除、每条都带 reason，就是给这个取舍留的退路。
 */
export function route(confidence: Confidence, eventType: EventType, reasons: readonly string[]): Routing {
  if (confidence !== "low") return { destination: "board", reasons };
  if (eventType === "other") {
    return { destination: "noise", reasons: [...reasons, "低置信且未识别出事件类型"] };
  }
  return { destination: "pending", reasons };
}

/** 用户可以修改的字段。改动会被记住，后续邮件不得覆盖。 */
export interface UserPatch {
  company?: string;
  eventType?: EventType;
  startUtc?: UtcIsoString | null;
  sourceTimeZone?: string | null;
}

export interface InboxRecord {
  event: StoredEvent;
  destination: Destination;
  reasons: readonly string[];
  /** 用户确认或修正过。这批记录是回流训练样本（方案 6.3 节 corrected_by_user）。 */
  correctedByUser: boolean;
  /** 用户改过哪些字段。合并后重新盖回去，保证用户的判断不被机器推翻。 */
  userPatch: UserPatch;
}

export type IngestResult =
  /** 预筛丢弃，没有产生记录。 */
  | { kind: "dropped"; reason: string }
  /** 同一封信又来了一次（rawHash 相同）。不递增 remindCount。 */
  | { kind: "duplicate"; dedupKey: string | null; rawHash: string }
  /** 新建了一条记录。 */
  | { kind: "created"; dedupKey: string; record: InboxRecord }
  /** 合并进了已有记录，remindCount 递增。 */
  | { kind: "merged"; dedupKey: string; record: InboxRecord };

/** StoredEvent 的目标日期。与 dedup.targetDateOf 同一套规则：用事件所在时区的日历日。 */
function targetDateOfStored(event: StoredEvent): string | null {
  if (event.startUtc === null) return null;
  if (event.sourceTimeZone === null) return event.startUtc.slice(0, 10);
  return localDateIn(event.startUtc, event.sourceTimeZone);
}

/** 与 dedup.dedupKeyOf 同一套规则，包括「没有公司名就永不合并」这一条。 */
function keyOfStored(event: StoredEvent): string {
  if (event.company.trim().length === 0) {
    const ref = event.sourceRefs[0] ?? "unknown";
    return `no-company:${ref}|${event.eventType}|${targetDateOfStored(event) ?? "no-date"}`;
  }
  return buildDedupKey({
    company: event.company,
    eventType: event.eventType,
    targetDate: targetDateOfStored(event),
  });
}

/** 把用户的修改盖到事件上，并同步 dedupKey。 */
function applyPatch(event: StoredEvent, patch: UserPatch): StoredEvent {
  const next: StoredEvent = {
    ...event,
    ...(patch.company !== undefined ? { company: patch.company, companyMatched: true } : {}),
    ...(patch.eventType !== undefined ? { eventType: patch.eventType } : {}),
    ...(patch.startUtc !== undefined ? { startUtc: patch.startUtc } : {}),
    ...(patch.sourceTimeZone !== undefined ? { sourceTimeZone: patch.sourceTimeZone } : {}),
  };
  // 用户给了时刻，dueType 必须跟着走，否则会违反 unknown ⇒ startUtc===null 的不变量
  const dueType =
    patch.startUtc === undefined
      ? next.dueType
      : patch.startUtc === null
        ? "unknown"
        : next.dueType === "unknown"
          ? "date_only"
          : next.dueType;
  const patched: StoredEvent = { ...next, dueType };
  return { ...patched, dedupKey: keyOfStored(patched) };
}

/**
 * 待确认收件箱的内存实现。
 *
 * 刻意做成纯内存、无依赖：1.3 接 Postgres 时，替换的是这个类的实现，
 * 而路由规则、合并语义、用户修正的优先级这些**决策**已经在这里定死并被测试
 * 覆盖了。把决策和存储分开，是为了让换存储的那一天不需要重新想一遍这些规则。
 */
export class InboxStore {
  private readonly records = new Map<string, InboxRecord>();
  private readonly seenHashes = new Map<string, string>();

  ingest(outcome: ParseOutcome): IngestResult {
    if (outcome.kind === "dropped") {
      return { kind: "dropped", reason: outcome.reason };
    }

    const seen = this.seenHashes.get(outcome.rawHash);
    if (seen !== undefined) {
      // 同一封信被转发两次。remindCount 表示「催了几次」，不是「收了几封」，
      // 所以这里不递增——否则用户会以为 HR 又催了一遍。
      return { kind: "duplicate", dedupKey: seen, rawHash: outcome.rawHash };
    }

    const key = dedupKeyOf(outcome.event);
    this.seenHashes.set(outcome.rawHash, key);

    const existing = this.records.get(key);
    if (existing === undefined) {
      const record = this.newRecord(outcome.event, outcome.trace.confidenceReasons);
      this.records.set(key, record);
      return { kind: "created", dedupKey: key, record };
    }

    const record = this.mergeInto(existing, outcome.event, outcome.trace.confidenceReasons);
    this.records.set(key, record);
    return { kind: "merged", dedupKey: key, record };
  }

  private newRecord(event: ParsedEvent, reasons: readonly string[]): InboxRecord {
    const stored = toStoredEvent(event);
    const routing = route(stored.confidence, stored.eventType, reasons);
    return {
      event: stored,
      destination: routing.destination,
      reasons: routing.reasons,
      correctedByUser: false,
      userPatch: {},
    };
  }

  /**
   * 合并新邮件。
   *
   * 用户修正过的记录只吃 remindCount 和 lastSeen，用户改过的字段一律盖回去。
   * 理由很直接：用户看过原文，机器没有。一封后到的低置信催办邮件把用户
   * 亲手改对的面试时间又改回错的，是最能摧毁信任的一种 bug，而且用户
   * 第二次不会再来改了。
   */
  private mergeInto(
    existing: InboxRecord,
    incoming: ParsedEvent,
    reasons: readonly string[],
  ): InboxRecord {
    const merged = mergeEvent(existing.event, incoming);
    if (existing.correctedByUser) {
      return {
        ...existing,
        event: applyPatch(merged, existing.userPatch),
      };
    }
    const routing = route(merged.confidence, merged.eventType, reasons);
    return {
      ...existing,
      event: merged,
      destination: routing.destination,
      reasons: routing.reasons,
    };
  }

  /** 用户点「确认」：进主看板，置信度升到 high，并标记为回流样本。 */
  confirm(dedupKey: string, patch: UserPatch = {}): InboxRecord | null {
    return this.applyUserDecision(dedupKey, patch, "board");
  }

  /** 用户点「这条没用」：折进噪音区。同样是回流样本——误报比漏报更值得学。 */
  dismiss(dedupKey: string): InboxRecord | null {
    return this.applyUserDecision(dedupKey, {}, "noise");
  }

  private applyUserDecision(
    dedupKey: string,
    patch: UserPatch,
    destination: Destination,
  ): InboxRecord | null {
    const current = this.records.get(dedupKey);
    if (current === undefined) return null;

    const mergedPatch: UserPatch = { ...current.userPatch, ...patch };
    const event = applyPatch(current.event, mergedPatch);
    const record: InboxRecord = {
      event: { ...event, confidence: destination === "board" ? "high" : event.confidence },
      destination,
      reasons: destination === "board" ? ["用户已确认"] : ["用户判定为无关"],
      correctedByUser: true,
      userPatch: mergedPatch,
    };

    this.records.delete(dedupKey);

    // 用户改了公司/类型/日期时 dedupKey 会变，可能撞上一条已有记录。
    // 撞上就并成一条，以用户修正过的这条为准，次数相加——留两条互相矛盾的
    // 记录比合并错更糟，用户会看到同一件事出现两次。
    const collided = this.records.get(record.event.dedupKey);
    if (collided !== undefined) {
      record.event.remindCount += collided.event.remindCount;
      for (const ref of collided.event.sourceRefs) {
        if (!record.event.sourceRefs.includes(ref)) record.event.sourceRefs.push(ref);
      }
    }
    this.records.set(record.event.dedupKey, record);
    return record;
  }

  get(dedupKey: string): InboxRecord | null {
    return this.records.get(dedupKey) ?? null;
  }

  /** 按去向列出记录。不传则返回全部。 */
  list(destination?: Destination): InboxRecord[] {
    const all = [...this.records.values()];
    return destination === undefined
      ? all
      : all.filter((r) => r.destination === destination);
  }

  /** 各去向的记录数，用于「待确认收件箱有几条」这类角标。 */
  counts(): Readonly<Record<Destination, number>> {
    const result = { board: 0, pending: 0, noise: 0 };
    for (const record of this.records.values()) result[record.destination] += 1;
    return result;
  }

  size(): number {
    return this.records.size;
  }
}
