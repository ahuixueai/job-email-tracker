// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
import type { Confidence, EventType } from "./types";
import { normalizeText } from "./text";
import { isVerificationNoise } from "./noise";

/**
 * 事件类型分类。
 *
 * dedup.ts 的 dedupKey 依赖调用方给出正确的 eventType，1.2 一接上收信管线
 * 就必须用——这是继时区推断之后第二个「现在不写、以后必然现写、现写必然
 * 糊」的模块。
 */

export interface EventTypeSignals {
  subject: string;
  body: string;
  /** 预留：暂未参与判定，未来可能用来微调置信度或辅助去重。 */
  senderDomain?: string;
}

export interface EventTypeClassification {
  eventType: EventType;
  /** 是否需要用户行动，决定要不要提醒和进日历。 */
  actionable: boolean;
  /** 是否应合并到已有事件而非新建。 */
  shouldMerge: boolean;
  /**
   * 这封信在说**哪一类事**。催办和改期邮件本身不是事件，是对已有事件的又一次
   * 提及——「重复提醒：京东笔试 0815 场」说的是那场笔试，不是一件叫「提醒」的事。
   *
   * eventType 描述**这封邮件是什么**（外部用例集要求催办判 reminder），
   * mergeAs 描述**它在说哪件事**。去重键要用后者，否则催办会另起一条记录，
   * 正是 baseline 第 2 节那个「同一场笔试存成两条」的原始缺陷。
   * 认不出被提醒的是什么事时为 null，此时只能当独立记录处理。
   */
  mergeAs: EventType | null;
  confidence: Confidence;
  /** 判定依据，便于人工复核。 */
  reason: string;
}

/** actionable 完全由 eventType 决定，见方案对「行动项 vs 通知」的划分。 */
const ACTIONABLE: Readonly<Record<EventType, boolean>> = {
  application_ok: false,
  assessment: true,
  interview: true,
  result: false,
  reminder: true,
  update: true,
  other: false,
};


/**
 * 五类正文信号词，按优先级从高到低排列。
 *
 * 顺序本身就是判定逻辑：命中即停，第一个匹配的类别赢。这天然实现了
 * 「行动项优先于结果通知」——assessment/interview/update 排在 result 前面，
 * 一封「恭喜通过初筛，请完成在线测评」的邮件在测到「测评」的瞬间就已经
 * 判定为 assessment，根本不会走到 result 分支去看「恭喜」「通过」这些词。
 * 不需要额外写一条「行动 vs 结果冲突时怎么办」的规则，顺序本身就是规则。
 */
const CATEGORY_ORDER: ReadonlyArray<readonly [EventType, RegExp]> = [
  [
    "assessment",
    /测评|笔试|试卷|\bassessment\b|skills\s+assessment|online\s+test|coding\s+(?:challenge|test)|technical\s+test|aptitude\s+test|take[-\s]home\s+(?:assignment|test|exercise)|\b(?:HackerRank|Codility|CodeSignal)\b/i,
  ],
  [
    "interview",
    /面试|视频面试|群面|终面|初面|一面|二面|三面|\binterview\b|phone\s+screen(?:ing)?|screening\s+call|recruiter\s+(?:call|screen)|\bsuperday\b|\bHireVue\b/i,
  ],
  [
    "update",
    /更新简历|补充简历|完善简历|补充信息|(?:更新|完善|补充)(?:或补充)?.{0,12}(?:简历信息|应聘信息|个人信息|申请表|登记表)|update\s+your\s+(resume|profile)|complete\s+your\s+profile|provide\s+additional\s+information/i,
  ],
  /**
   * 英文的**明确决定**排在 application_ok 之前。
   *
   * 英文拒信几乎都以「Thank you for applying / for your application」开头，
   * 不提前拦一道就会被下面的 application_ok 抢走——把一封拒信显示成「投递成功」。
   * 这里只放不会以条件句形式出现在回执里的强表述；「if you are not selected…」
   * 这类回执常用的条件句故意不收，否则回执会反过来被判成结果。
   */
  [
    "result",
    /regret\s+to\s+inform|(?:will|are|have\s+decided)\s+not\s+(?:to\s+)?(?:be\s+)?(?:mov(?:e|ing)|proceed(?:ing)?|progress(?:ing)?)\s+forward|not\s+(?:be\s+)?(?:moving|proceeding|progressing)\s+(?:forward\s+)?with\s+your|(?:move|proceed|moving|proceeding)\s+forward\s+with\s+other\s+candidates|unable\s+to\s+offer\s+you|offer\s+of\s+employment|pleased\s+to\s+(?:offer|extend)/i,
  ],
  [
    "application_ok",
    /已收到你的申请|已收到您的申请|已收到(?:你|您)对.{1,40}?的(?:申请|投递)|简历已收到|已成功投递|投递成功|投递确认|进入评估流程|收到(你|您)的(简历|申请)|thank\s+you\s+for\s+your\s+application|successful\s+application|we\s+will\s+review\s+(it|your\s+application)|(?:thank\s+you|thanks)\s+for\s+applying|received\s+your\s+application|application\s+(?:has\s+been\s+|was\s+)?(?:received|submitted)/i,
  ],
  [
    "result",
    /很遗憾|遗憾的是|很抱歉地?通知|未通过|暂不匹配|无法进入.{0,10}下一(?:阶段|环节|轮)|暂时无法.{0,6}继续前进|不再(推进|继续)|not\s+to\s+move\s+forward|decided\s+not\s+to|录用意向|offer\s+letter|发出录用|pleased\s+to\s+(offer|extend)/i,
  ],
];

/**
 * 正文优先于标题：body 是唯一的判定来源，命中即用；body 什么都没命中
 * 才退回标题。这条顺序关系不是「加权」，是硬优先级——
 *
 * baseline 的真实反例：有一封信标题写「测评邀请」，正文其实是 AI 视频
 * 面试。如果把标题和正文拼在一起统一计数，「测评」（标题里 1 次）会跟
 * 「面试」（正文里 2 次）搅在一起，结果对不对全凭巧合的出现次数。
 * body-first 让这类「标题党」邮件失效：正文里读不出「测评」，
 * 无论标题怎么写都不会被判成 assessment。
 */
function scanCategory(subject: string, body: string): readonly [EventType, RegExp] | null {
  for (const entry of CATEGORY_ORDER) {
    if (entry[1].test(body)) return entry;
  }
  for (const entry of CATEGORY_ORDER) {
    if (entry[1].test(subject)) return entry;
  }
  return null;
}

/**
 * 改期通知：本质是「原事件的更新」，应合并到原事件并覆盖时间，
 * 而不是新建一条 update。分类结果是「被改期的那个事件类型」
 * （面试改期还是面试，不会因为改期就变成 update），但强制 shouldMerge=true。
 */
const RESCHEDULE_MARK = /时间调整|调整至|改期|重新安排|reschedul(?:e|ing|ed)|原定.{0,30}(?:调整|改)/;

/**
 * 催办/紧急提醒：要么是明确的「提醒」前缀（重复提醒、Reminder:、Re:），
 * 要么是「即将到期」的紧迫框架（即将截止、N 小时后截止、已重置）。
 *
 * 「（第二次提醒）」这类夹在句尾的括注不算——那只是催办次数的标注，
 * 邮件本身说的事（补充简历信息）该是什么类型还是什么类型，不因为
 * 括注里出现了「提醒」二字就整体判成 reminder。所以「前缀式提醒」要求
 * 出现在文本开头，而不是全文任意位置搜「提醒」这个词。
 */
const LEAD_REMINDER = /^[【\[]?(?:重复提醒|再次提醒|reminder\s*[:：]|re\s*[:：])/i;
const URGENCY_OR_RESET =
  /即将截止|将于.{0,8}后截止|expires?\s+in\s+\d|starts?\s+in\s+\d|已重置|网络故障|link\s+has\s+expired/i;

function looksLikeReminder(subject: string, body: string): boolean {
  if (LEAD_REMINDER.test(subject.trim()) || LEAD_REMINDER.test(body.trim())) return true;
  return URGENCY_OR_RESET.test(subject) || URGENCY_OR_RESET.test(body);
}

/**
 * 标题点明「这是一张问卷」：面试体验满意度调查、候选人体验调研。
 *
 * 这类信的正文必然出现「面试」「测评」——它问的就是那场面试——而且常带
 * 「24 小时内完成问卷」这样的期限，于是会被判成一场有截止时间的面试摆上日程。
 * 它不是流程里的任何一步，填不填都不影响结果。只看标题，正文里顺带提到问卷的不算。
 */
const SURVEY_SUBJECT = /满意度|体验(?:调查|调研|反馈问卷)|问卷调查|调研问卷|(?:satisfaction|experience)\s+survey/i;

/**
 * 标题点明「要你补材料」：更新应聘信息、完善网申登记表、填写应聘登记表。
 *
 * 正文优先于标题这条原则（见 scanCategory）防的是标题党——标题写测评、正文是面试。
 * 补材料类正好反过来：标题说得很准，正文却几乎总会带一句「以免影响后续面试安排」
 * 「请在面试前完成」，被排在前面的 interview 抢走。所以这一类单独先看标题。
 */
const UPDATE_SUBJECT =
  /(?:更新|完善|补充|填写).{0,12}(?:简历|应聘信息|个人信息|登记表|申请表)|(?:登记表|申请表).{0,14}(?:填写|完善|更新)/;

export function classifyEventType(signals: EventTypeSignals): EventTypeClassification {
  const subject = normalizeText(signals.subject ?? "");
  const body = normalizeText(signals.body ?? "");
  const full = `${subject} ${body}`;

  const withActionable = (
    eventType: EventType,
    shouldMerge: boolean,
    confidence: Confidence,
    reason: string,
    mergeAs: EventType | null = null,
  ): EventTypeClassification => ({
    eventType,
    actionable: ACTIONABLE[eventType],
    shouldMerge,
    confidence,
    reason,
    mergeAs,
  });

  if (subject.trim().length === 0 && body.trim().length === 0) {
    return withActionable("other", false, "low", "空文本");
  }

  if (isVerificationNoise(subject, body)) {
    return withActionable("other", false, "low", "命中验证码/邮箱验证等非求职噪音");
  }

  if (SURVEY_SUBJECT.test(subject)) {
    return withActionable("other", false, "low", "标题是满意度调查/问卷：不是流程里的一步");
  }

  if (RESCHEDULE_MARK.test(full)) {
    const underlying = scanCategory(subject, body);
    const type = underlying?.[0] ?? "update";
    return withActionable(
      type,
      true,
      "high",
      `改期通知：原事件类型为 ${type}，合并到已有事件并覆盖时间，而非新建`,
      type,
    );
  }

  if (looksLikeReminder(subject, body)) {
    const about = scanCategory(subject, body)?.[0] ?? null;
    return withActionable(
      "reminder",
      true,
      "high",
      about === null
        ? "催办/紧急提醒：但认不出在提醒哪一类事，只能作为独立记录"
        : `催办/紧急提醒：在提醒一件 ${about}，按该事件的 dedupKey 合并`,
      about,
    );
  }

  if (UPDATE_SUBJECT.test(subject)) {
    return withActionable("update", false, "high", "标题命中补充/更新材料：按 update 处理，不看正文里顺带提到的环节词");
  }

  const hit = scanCategory(subject, body);
  if (hit) {
    const [type, pattern] = hit;
    const fromBody = pattern.test(body);
    return withActionable(
      type,
      false,
      "high",
      `${fromBody ? "正文" : "标题"}命中 ${type} 信号词`,
    );
  }

  // 没有任何正面信号命中：宁可不认，不能瞎猜。求职培训营销、广撒网的岗位
  // 推荐邮件都落在这里——它们的关键词（offer、大厂、招聘）跟真实流程进展
  // 高度重叠，没有为它们单独建一套「噪音黑名单」，而是让「不够具体」
  // 本身成为默认的安全出口，跟 dueType.ts 对未知时间的处理是同一个立场。
  return withActionable("other", false, "low", "没有命中任何已知事件类型信号");
}
