import type { Confidence, ParsedEvent } from "./types.js";
import { isConsistentDue } from "./types.js";
import type { CleanEmail, RawEmail } from "./rawEmail.js";
import { toCleanEmail } from "./rawEmail.js";
import type { PrefilterResult } from "./prefilter.js";
import { prefilter } from "./prefilter.js";
import type { Extraction, LLMExtractor } from "./extract.js";
import { validateExtraction } from "./extract.js";
import { normalizeCompany } from "./company.js";
import type { EventTypeClassification } from "./eventType.js";
import { classifyEventType } from "./eventType.js";
import type { DueClassification } from "./dueType.js";
import { classifyDue } from "./dueType.js";
import type { TimeZoneInference } from "./timezone.js";
import { inferTimeZone } from "./timezone.js";
import { composeConfidence } from "./confidence.js";
import type { EventFormatClassification } from "./eventFormat.js";
import { classifyEventFormat } from "./eventFormat.js";
import type { ActionInfo } from "./actionInfo.js";
import { extractActionInfo } from "./actionInfo.js";

/**
 * 解析管线：一封原始邮件 → 一条 ParsedEvent。
 *
 * 顺序不是随意的，每一步都依赖前一步的产出：
 *
 *   清洗 → 预筛 → LLM 抽取 → 公司归一 → 事件类型 → 时区推断 → 时间语义 → 置信度合成
 *
 * 公司归一必须排在时区推断之前，因为时区推断的 P4 线索是「台账里这家公司
 * 已有的地区」——不先知道是哪家公司，这条线索用不上。
 * 时区推断必须排在时间语义之前，因为把墙上时间换算成 UTC 需要时区。
 *
 * 全程只做转换不做存储，也从不保留原文（方案 6.1 节：原文处理完立即删除）。
 */

export interface ParseDeps {
  extractor: LLMExtractor;
  /**
   * 台账查询：这家公司已有的地区记录，喂给时区推断的第 4 优先级。
   * 传入公司**归一化后**的标准名。查不到返回 null。
   */
  lookupCompanyRegion?: (company: string) => string | null;
}

/** 岗位侧信息。不进 events 表，用于填 applications 表的 role / region。 */
export interface ApplicationHint {
  company: string;
  companyMatched: boolean;
  role: string | null;
  /**
   * 地点原文。**它不参与本封邮件的时区推断**——全文扫描已经覆盖了正文里的
   * 地点词，再喂一遍是重复劳动。它的价值在下一封信：写进 applications.region
   * 之后，同一家公司后续那些正文里不写地点的邮件就能靠第 4 优先级拿到时区。
   */
  region: string | null;
}

/** 每一步的中间结论，全部保留。用户点开「为什么是这个结果」看到的就是它。 */
export interface ParseTrace {
  prefilter: PrefilterResult;
  extraction: Extraction;
  eventType: EventTypeClassification;
  /** 事件的形式（电话面 / 视频面 / AI 面 / 笔试 / 测评……）。只是展示信息，不参与置信度与去重。 */
  format: EventFormatClassification;
  /** 做这件事要用到的入口链接与凭据。纯规则逐字摘出，只是展示信息。 */
  action: ActionInfo;
  tz: TimeZoneInference;
  due: DueClassification;
  confidenceReasons: readonly string[];
  /** 事件类型是否采纳了模型建议（规则无结论时的兜底）。 */
  usedEventTypeHint: boolean;
}

export type ParseOutcome =
  | {
      kind: "dropped";
      emailId: string;
      rawHash: string;
      reason: string;
    }
  | {
      kind: "parsed";
      emailId: string;
      rawHash: string;
      event: ParsedEvent;
      application: ApplicationHint;
      trace: ParseTrace;
    };

export async function parseEmail(raw: RawEmail, deps: ParseDeps): Promise<ParseOutcome> {
  const email = toCleanEmail(raw);

  const pre = prefilter(email);
  if (pre.verdict === "drop") {
    return { kind: "dropped", emailId: email.id, rawHash: email.rawHash, reason: pre.reason };
  }

  // 再校验一次模型输出。StubExtractor 的返回值本来就是合法的，
  // 但真实实现是网络那头的 JSON，接口类型挡不住脏值——在这里挡一道，
  // 代价是几次字符串操作，收益是任何实现都不可能把幻觉塞进时间字段。
  const extraction = validateExtraction(await deps.extractor.extract(email), email.text);

  return {
    kind: "parsed",
    emailId: email.id,
    rawHash: email.rawHash,
    ...assemble(email, pre, extraction, deps),
  };
}

function assemble(
  email: CleanEmail,
  pre: PrefilterResult,
  extraction: Extraction,
  deps: ParseDeps,
): { event: ParsedEvent; application: ApplicationHint; trace: ParseTrace } {
  // ---- 1. 公司归一。排在最前面，因为时区推断的第 4 优先级要用它查台账 ----
  const company = normalizeCompany(extraction.companyRaw ?? "", email.senderDomain);

  // ---- 2. 事件类型 ----
  const ruleType = classifyEventType(
    email.senderDomain.length > 0
      ? { subject: email.subject, body: email.body, senderDomain: email.senderDomain }
      : { subject: email.subject, body: email.body },
  );

  // 规则彻底没结论时才采纳模型建议，且采纳的代价是整条记录降到 low
  // 进待确认收件箱。这不是给模型「投票权」，是给规则的盲区一个出口：
  // 与其把一封真实面试邀请判成 other 悄悄沉掉，不如带着「待确认」标记
  // 摆到用户面前，让他一键确认——那一次点击同时也是回流样本。
  const useHint =
    ruleType.eventType === "other" &&
    ruleType.confidence === "low" &&
    // 规则确定是问卷 / 宣讲会 / 招聘网站推荐时，不给模型「把它捞回来」的口子
    ruleType.final !== true &&
    extraction.eventTypeHint !== null &&
    extraction.eventTypeHint !== "other";

  // ParsedEvent 描述的是**事件**，不是邮件。催办和改期邮件本身不构成新事件，
  // 它们是对某件已存在的事的又一次提及，所以这里取 mergeAs——
  // 「重复提醒：京东笔试 0815 场」入库时的类型必须是 assessment，
  // 否则它的 dedupKey 是「京东|reminder|08-15」，跟原记录「京东|assessment|08-15」
  // 对不上，催办会另起一条。那正是 baseline 第 2 节记录的原始缺陷：
  // 1.1 的分类器给对了 shouldMerge，但没人消费它，端到端串起来才暴露。
  const ruleEventType = ruleType.mergeAs ?? ruleType.eventType;

  /**
   * 规则有结论、模型也有结论、两者不一样。
   *
   * 真实邮件评测（147 封）里，规则判类型 92 封对 77 封，错的几乎全是同一种：
   * 投递回执、问卷、广告里顺带提了一句「后续会有测评 / 面试」，规则见词就判。
   * 而模型在这件事上对了 85 封，且 55 封广告里它对 47 封说了「这不是流程事件」，
   * 92 封真流程邮件里一封都没说错。
   *
   * 但这里**不让模型改写类型**。宪法没变：模型只提意见，规则做决定。
   * 分歧的处理方式是降级——把这封信从日程挪到待确认，让用户自己看一眼。
   * 模型因此只有否决权，没有提名权：它不能让任何一封信进日程。
   */
  const hint = extraction.eventTypeHint;
  /**
   * 模型说「这是一封催办」不算分歧。
   *
   * reminder 描述的是这封信的**性质**（又催了一次），不是它在说哪件事，
   * 和规则判出的 assessment / update 并不矛盾——管线自己也是这么处理催办的：
   * 类型取被催的那件事（mergeAs），合并进已有记录。把它当成分歧，
   * 一封「请尽快完善登记表」就会因为模型多说了一句「这是催办」被挪去待确认。
   */
  const hintAgrees =
    hint === ruleType.eventType || hint === ruleEventType || hint === "reminder";
  const eventTypeConflict =
    ruleType.eventType !== "other" && hint !== null && !hintAgrees
      ? { rule: ruleEventType, hint }
      : null;

  // ---- 3. 时区推断 ----
  const knownRegion = deps.lookupCompanyRegion?.(company.canonical) ?? null;
  const tz = inferTimeZone({
    text: email.text,
    ...(email.senderDomain.length > 0 ? { senderDomain: email.senderDomain } : {}),
    ...(knownRegion !== null ? { knownCompanyRegion: knownRegion } : {}),
  });

  // ---- 4. 时间语义。timeText 是模型圈出的那一小段：只用它限定「看哪几个时刻」，
  // 语气词仍在全文上下文里判；圈不出就用全文兜底 ----
  const focused = classifyDue(email.text, email.receivedAtUtc, tz.tz ?? "", extraction.timeText);

  /**
   * 模型圈的那句话里没有场次，但全文里有一个还没到的场次：场次赢，并且降级。
   *
   * 真实例子：一封面试邀约同时写了「面试时间：10/27 13:30」和「请在 10 月 9 日
   * 9:00 前回复是否参加」，模型圈的是后一句。只看圈选，这封信会变成一条
   * 「10/9 截止」摆上日程，真正的面试时间不见了——这正是铁律一要防的方向
   * （把场次当成截止 → 错过考试）。
   *
   * 这里采用全文读出的场次（铁律一：场次优先），同时把整条记录压到待确认：
   * 模型和规则对「哪个时间才是正事」看法不同，这件事必须让用户看见。
   * 只认还没到的场次——已经过去的时刻多半是签名档、引用历史里的旧时间。
   */
  let due = focused;
  let timeScopeConflict = false;
  if (extraction.timeText !== null && focused.dueType !== "fixed_start") {
    const whole = classifyDue(email.text, email.receivedAtUtc, tz.tz ?? "");
    if (
      whole.dueType === "fixed_start" &&
      whole.confidence !== "low" &&
      whole.startUtc !== null &&
      Date.parse(whole.startUtc) > Date.parse(email.receivedAtUtc)
    ) {
      due = whole;
      timeScopeConflict = true;
    }
  }

  /**
   * 模型说「这不是流程事件」，而规则这边也拿不出一个具体时刻：按噪音折叠。
   * 典型是岗位推荐广告——正文里有「面试」「笔试」这些词，但没有任何一件
   * 需要用户在某个时刻去做的事。
   *
   * 只要规则解析出了具体时刻就不走这条：一封带着明确时间的信，哪怕模型说
   * 它无关，也留在待确认里让用户裁决，而不是折叠掉。折叠掉一场真考试的代价
   * 远大于待确认里多一条广告。
   */
  const vetoed = eventTypeConflict?.hint === "other" && due.startUtc === null;

  const eventType = vetoed
    ? "other"
    : useHint && hint !== null
      ? hint
      : ruleEventType;

  // ---- 5. 置信度合成 ----
  const composed = composeConfidence({
    eventType,
    eventTypeConfidence: ruleType.confidence,
    dueType: due.dueType,
    dueConfidence: due.confidence,
    startUtc: due.startUtc,
    hasCompany: company.canonical.length > 0,
    companyMatched: company.matched,
    tz,
    truncated: email.truncated,
    usedEventTypeHint: useHint,
    notJobRelated: extraction.notJobRelated,
    eventTypeConflict,
    timeScopeConflict,
  });

  // ---- 6. 组装。结构性不变量在这里断言，不让脏数据流进数据层 ----
  const event: ParsedEvent = {
    company: company.canonical,
    companyMatched: company.matched,
    eventType,
    dueType: due.dueType,
    startUtc: due.startUtc,
    endUtc: due.endUtc,
    // 时区推断不出来时 due 里的时刻要么来自相对期限（与时区无关），
    // 要么已经被 classifyDue 降级掉了，这里如实写 null，绝不兜底一个默认时区
    sourceTimeZone: tz.tz,
    confidence: composed.confidence,
    receivedAtUtc: email.receivedAtUtc,
    sourceRef: email.id,
  };

  assertConsistent(event);

  return {
    event,
    application: {
      company: company.canonical,
      companyMatched: company.matched,
      role: extraction.roleRaw,
      region: extraction.locationRaw,
    },
    trace: {
      prefilter: pre,
      extraction,
      eventType: ruleType,
      format: classifyEventFormat(email.text, eventType, email.subject),
      action: extractActionInfo(email.body),
      tz,
      due,
      confidenceReasons: composed.reasons,
      usedEventTypeHint: useHint,
    },
  };
}

/**
 * dueType=unknown 却带着一个时刻，是「凭空生成钟点」的典型形态，
 * 方案 4.3 节明令禁止。这里抛异常而不是静默修正：能走到这一步说明上游
 * 逻辑坏了，静默修正只会让真正的 bug 藏得更深。
 */
function assertConsistent(event: ParsedEvent): void {
  if (!isConsistentDue(event.dueType, event.startUtc)) {
    throw new Error(
      `解析结果违反结构性不变量：dueType=${event.dueType} 却带 startUtc=${event.startUtc}`,
    );
  }
}

/** 供 UI 与日志使用：把一条解析结果压成一行可读摘要。 */
export function summarize(outcome: ParseOutcome): string {
  if (outcome.kind === "dropped") return `[丢弃] ${outcome.emailId}：${outcome.reason}`;
  const e = outcome.event;
  const when = e.startUtc ?? "无时间";
  const conf: Confidence = e.confidence;
  return `[${conf}] ${e.company} · ${e.eventType} · ${e.dueType} · ${when}`;
}
