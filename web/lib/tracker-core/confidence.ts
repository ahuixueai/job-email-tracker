// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
import type { Confidence, DueType, EventType } from "./types";
import type { TimeZoneInference } from "./timezone";

/**
 * 置信度合成。
 *
 * 四路信号各自算出一个置信度，这里合成一个总值。总值决定路由：
 * high/medium 进主看板，low 进待确认收件箱（方案 v0.2 第 4.3 节）。
 *
 * 采用木桶原理（取最低）+ 显式降级条款，而不是加权打分。
 * 加权分在这里是错的工具：0.7 这个数没法向用户解释，也没法回归测试。
 * 「因为公司名没归一上，所以最高只能是 medium」是一句人能读懂、能吵架、
 * 能写成断言的话。
 */

export interface ConfidenceInputs {
  eventType: EventType;
  eventTypeConfidence: Confidence;
  dueType: DueType;
  dueConfidence: Confidence;
  /** 有具体时刻时为 UTC 串，否则 null。用于判断能不能渲染双时区。 */
  startUtc: string | null;
  /** 公司名是否非空。连是哪家公司都不知道的记录，看板上没有意义。 */
  hasCompany: boolean;
  companyMatched: boolean;
  tz: TimeZoneInference;
  /** 正文被截断：时间信息可能丢在尾部。 */
  truncated: boolean;
  /** 事件类型来自 LLM 建议而非规则命中。 */
  usedEventTypeHint: boolean;
  /** 模型认为与求职无关。 */
  notJobRelated: boolean;
  /**
   * 规则和模型对「这是哪一类事」给出了不同答案。
   * 不传或传 null 表示没有分歧（包括模型没给意见的情况）。
   */
  eventTypeConflict?: { rule: EventType; hint: EventType } | null;
  /**
   * 模型圈出的时间片段里没有场次，但全文里另有一个未到的场次，管线采用了后者。
   * 见 pipeline.ts。
   */
  timeScopeConflict?: boolean;
}

export interface ConfidenceResult {
  confidence: Confidence;
  /** 每一条生效的降级理由，原样透传到 UI 的「为什么待确认」。 */
  reasons: readonly string[];
}

const RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };
const BY_RANK: readonly Confidence[] = ["low", "medium", "high"];

function lower(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b;
}

/**
 * 时间是这个事件类型的必备信息吗？
 *
 * 只有测评和面试算。这两类没有时间就是解析漏了东西，用户拿到一条
 * 「某公司面试」却不知道什么时候，等于没有。
 *
 * 刻意不含 update 和 reminder：「补充简历」这类流程更新本来就常常不带期限，
 * 把它们也算进来，待确认收件箱会被大量本来就没问题的记录淹没——
 * 那会让「待确认」这个一等公民退化成没人看的垃圾桶，比漏一条更糟。
 */
const TIME_CRITICAL: ReadonlyArray<EventType> = ["assessment", "interview"];

export function composeConfidence(input: ConfidenceInputs): ConfidenceResult {
  const reasons: string[] = [];
  let level: Confidence = input.eventTypeConfidence;
  if (level !== "high") reasons.push(`事件类型置信度为 ${level}`);

  /**
   * 记一条降级理由并压低上限。
   *
   * 理由是**只要条件成立就记**，不管这次有没有真的把等级压下去。
   * 早先的写法是「只有真降了才记」，结果是：一条同时「公司没归一上」
   * 又「正文被截断」的记录，用户只看得到第一条——他照着改完公司名，
   * 发现还是待确认，却不知道为什么。可解释性要的是全部原因，不是第一个原因。
   */
  const cap = (limit: Confidence, why: string): void => {
    if (RANK[level] > RANK[limit]) level = limit;
    if (RANK[limit] < RANK.high) reasons.push(why);
  };

  // 时间通道：只在这类事件本该有时间时才参与合成。
  // 「已收到你的申请」没有时间是正常的，不该因此降级；
  // 「面试邀请」没有时间是漏了，必须降级。
  const timeMatters = TIME_CRITICAL.includes(input.eventType);
  if (timeMatters) {
    if (input.dueType === "unknown") {
      cap("low", `${input.eventType} 类事件没有解析出任何时间，必须人工确认`);
    } else {
      level = lower(level, input.dueConfidence);
      if (input.dueConfidence !== "high") {
        reasons.push(`时间语义置信度为 ${input.dueConfidence}`);
      }
    }
  } else if (input.dueType !== "unknown" && input.dueConfidence === "low") {
    // 非必备类别里解析出了一个低可信的时间：时间本身不可信，但事件仍然成立
    cap("medium", "解析出的时间可信度低，事件本身仍可入库");
  }

  // 有具体时刻却不知道时区：这个时刻多半来自相对期限（「72 小时内」），
  // 算得准，但没法给用户渲染「纽约 / 北京」双时区，也没法跨时区排序。
  if (input.startUtc !== null && input.tz.tz === null) {
    cap("medium", "有具体时刻但时区未知，无法双时区显示");
  }

  if (!input.hasCompany) {
    cap("low", "没有解析出公司名：无法归属到任何一次投递");
  } else if (!input.companyMatched) {
    cap("medium", "公司名未命中别名表，不能作为跨记录合并的强依据");
  }

  if (input.truncated) {
    cap("medium", "正文超长被截断，尾部可能还有时间信息");
  }

  if (input.usedEventTypeHint) {
    cap("low", "事件类型来自模型建议而非规则命中");
  }

  // 两个独立判断打架，本身就是不确定的证据。这里不裁决谁对——
  // 模型没有把一封信送进日程的权力，但它的异议足以把一封信拦在日程外面。
  const conflict = input.eventTypeConflict ?? null;
  if (conflict !== null) {
    cap(
      "low",
      conflict.hint === "other"
        ? `规则判为 ${conflict.rule}，但模型认为这不是一件流程事件`
        : `规则判为 ${conflict.rule}，模型判为 ${conflict.hint}，两边不一致`,
    );
  }

  if (input.timeScopeConflict === true) {
    cap("low", "模型圈出的那句话里没有场次，但全文另有一个未到的场次；已按场次优先采用，需人工确认是哪一个");
  }

  if (input.notJobRelated) {
    cap("low", "模型判断这封信与求职无关");
  }

  return { confidence: level, reasons };
}

/** 供测试与 UI 使用：把置信度转成可比较的序号。 */
export function confidenceRank(value: Confidence): number {
  return RANK[value];
}

/** 序号转回置信度，越界取最低。 */
export function confidenceFromRank(rank: number): Confidence {
  return BY_RANK[rank] ?? "low";
}
