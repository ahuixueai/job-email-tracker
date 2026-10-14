import type { Confidence, DueType, IanaTimeZone, UtcIsoString } from "./types.js";
import {
  findExplicitTimeZone,
  inferTimeZone,
  isValidTimeZone,
  localDateIn,
  wallClockPartsToUtc,
  type TimeZoneInference,
  type TimeZoneSignals,
} from "./timezone.js";
import { CN_NUM, normalizeText, parseCount } from "./text.js";
import { findDates, type DateHit } from "./dateParse.js";
import { findTimes, type TimeHit } from "./timeParse.js";
import { addBusinessDays, findRelativeDeadline } from "./relative.js";
import { isVerificationNoise } from "./noise.js";

/**
 * 时间语义分类。本模块是整个系统最容易造成实质伤害的地方。
 *
 * 判错的后果（baseline 报告第 1 节）：
 *   把 deadline 当 fixed_start → 用户白白紧张、空等
 *   把 fixed_start 当 deadline → 用户彻底错过考试  ← 致命
 */

export interface DueClassification {
  dueType: DueType;
  startUtc: UtcIsoString | null;
  endUtc: UtcIsoString | null;
  confidence: Confidence;
  /** 判定依据，便于人工复核与回流标注。 */
  reason: string;
  /** 正文里显式写明的时区（如 EST / SGT / 北京时间），没有则为 null。 */
  explicitTimeZone: IanaTimeZone | null;
  /**
   * 找到了日期与钟点、却因为时区未知没能换算时，信里写的那个**墙上时间**（`YYYY-MM-DDTHH:mm`）
   * 和它的性质。只给人工确认时预填用——它不是 UTC，不能当成时刻参与任何计算。
   */
  unzoned?: { local: string; kind: "fixed_start" | "deadline" };
}

/**
 * 「X日前」解释为当日结束（23:59），而不是当日零点。
 *
 * 这条曾经取 false，理由是「更早截止 = 更安全」。那个理由是错的，
 * 错在**把安全边界加在了数据层**。
 *
 * 安全边界属于提醒层：方案 6.4 节的策略本来就是「截止前 3 天 / 1 天 / 3 小时」。
 * 把它塞进数据层，后果是每个下游都继承一个错误的事实——日历事件画在错误的位置、
 * 倒计时少一天、优先级排序被扭曲，而且下游看不到原文，无法纠正。
 *
 * 而且那个「保守」防的是一个几乎不发生的场景：HR 写「8月20日前提交」表示
 * 「20 日零点截止」在实践中基本不存在。为防它，代价是在常见情况下每次都把用户
 * 提前一整天——这不是保守，是系统性报错，只不过错在「早」的方向。
 * 用户发现真实截止是 23:59 之后，会得出「这个系统的时间不可信」的结论，
 * 与显示错误时间导致错过考试是同一种信任崩塌，只是慢一点。
 *
 * 结论：数据层记录对事实的最佳估计，安全余量交给提醒层。
 */
const CN_BEFORE_MEANS_END_OF_DAY = true;


/** 期限语气词。出现在日期附近时，即使有完整钟点也判 deadline 而非场次。 */
const CN_DEADLINE_MARK = /截止|截至|之前|以前|前完成|前提交|前确认|前反馈|逾期|失效|过期/;
const CN_BEFORE_ONLY = /日前|号前|前/;

/**
 * 紧跟在「日期+钟点」后面的「前」。
 *
 * 「X 前 + 动词」在中文里就是截止句式，但动词是开放集——原先写死
 * 「前完成/前提交/前确认/前反馈」四个搭配，「前登录」「前上传」直接漏判。
 * 不能改成裸的 /前\S/ 去泛化：「请提前登录」里的「提前登录」同样含「前+动词」，
 * 那是场次前的准备提示，不是截止。
 *
 * 正确的锚点不在「前」的右边而在左边——**要求「前」字紧贴在时间表达之后**。
 * 这个函数只吃 ctx.suffix，而 suffix 按定义就是从时间表达末尾开始的，
 * 所以「^ + 可选标点 + 前」这个锚定本身就等价于「前字左侧必须是时间表达」，
 * 一次排掉「提前 / 目前 / 事前」整类，不用逐个拉黑名单。
 *
 * 时间和「前」之间允许夹一个短括注：「2026-09-25 00:00（北京时间）前填写」
 * 「17:00（回复截止时间）前反馈」。真实邮件里这种写法很常见，括注只是在补充
 * 说明这个时刻，不改变「…前 + 动词」的截止句式。括注限 12 字以内，
 * 防止把一整句插入语吃进来。
 */
const CN_BEFORE_AFTER_TIME = /^[\s，,、]*(?:[（(][^（）()\n]{0,12}[）)]\s*)?(?:日|号)?(?:之|以)?前/;

/**
 * 签发/生效语气词：这个时刻说的是「通知本身什么时候发出、什么时候激活」，
 * 既不是用户要到场的场次，也不是用户要赶的截止。
 *
 * ⚠️ 这张表是**辅助**判据，不是唯一防线。签发的说法没有共同结构特征
 * （生效/签发/发出/已下发…），漏一个词就退回误判。真正兜底的是
 * classifySection 里那条不依赖词表的结构判据：**候选时刻 ≤ 收信时刻的，
 * 不得当选首个 fixed 候选**——一场"考试"如果在收信当下就已经过去，
 * 它本来就不可能是等着用户去参加的未来场次。
 */
const ISSUANCE_MARK = /生效|签发|发出|发放|下发|邀请于|通知于/;
/**
 * 英文的「窗口开放」：`The test window opens on 12 Oct, 9:00 AM and closes on 14 Oct, 6:00 PM`。
 * 开放时刻不是场次——用户不需要在那一刻到场，真正要赶的是后面的 closes。
 * 归到和签发时刻同一类处理：跳过它，继续往下找。
 * 只看紧贴在时间**前面**的词；`starts at` 不在这里，那是真场次（见 START_MARK）。
 */
const EN_WINDOW_OPEN_MARK = /\b(?:opens?|opening|available|accessible)\s+(?:on|from|at|as\s+of)?\s*$/i;
const EN_DEADLINE_MARK =
  /\b(deadline|due|expires?|expiry|closes?|closing|no later than|by|before|submit by|complete by)\b/i;

/** 固定场次语气词。与期限词同时出现时，场次优先。 */
const START_MARK =
  /考试时间|面试时间|笔试时间|测评时间|宣讲会时间|开考|开始时间|定于|安排在|安排于|scheduled\s+(for|at)|confirmed\s+for|takes?\s+place|starts?\s+at|will\s+begin/i;

/**
 * 显式时区识别已移到 timezone.ts（inferTimeZone 的 P1 线索），这里直接复用，
 * 避免两处名单各自维护后慢慢漂移。
 */

/** 钟点跟在日期之后时允许的间隔。中英文都是这个书写顺序，放宽些。 */
const PAIR_FORWARD = 16;
/**
 * 钟点写在日期之前的间隔。刻意收紧：
 * 「重复提醒（同 08-13 16:02 内容），…0815 场 10:00-11:40」里，
 * 放宽会让 0815 和前面无关的 16:02 配上对，把场次读成 16:02。
 */
const PAIR_BACKWARD = 8;
/** 判断语气词时向前后各看多少字符。 */
const CONTEXT_WINDOW = 20;

function pairDateWithTime(date: DateHit, times: readonly TimeHit[]): TimeHit | null {
  // 先向后找：「8月15日 10:00」「August 20 at 11:59 PM」是常态
  for (const time of times) {
    if (time.index >= date.end && time.index - date.end <= PAIR_FORWARD) return time;
  }
  // 再向前找：「10:00 于 8月22日」这类倒装少见，窗口给得很窄
  for (const time of times) {
    if (time.end <= date.index && date.index - time.end <= PAIR_BACKWARD) return time;
  }
  return null;
}

/**
 * 在全文里定位一个片段，容忍空白差异（与接地检查同一口径）。
 * 找不到返回 null。
 */
function locateFragment(source: string, fragment: string): { start: number; end: number } | null {
  const map: number[] = [];
  let dense = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (/\s/.test(ch)) continue;
    dense += ch.toLowerCase();
    map.push(i);
  }
  const needle = fragment.replace(/\s+/g, "").toLowerCase();
  if (needle.length === 0) return null;
  const at = dense.indexOf(needle);
  if (at === -1) return null;
  const start = map[at] as number;
  const end = (map[at + needle.length - 1] as number) + 1;
  return { start, end };
}

interface Context {
  prefix: string;
  suffix: string;
}

function contextAround(text: string, start: number, end: number): Context {
  return {
    prefix: text.slice(Math.max(0, start - CONTEXT_WINDOW), start),
    suffix: text.slice(end, end + CONTEXT_WINDOW),
  };
}

/**
 * 一个「日期+钟点」候选在说什么。三分而不是二分。
 *
 * 原先是二分（是截止 / 不是截止 → 那就是场次），把「签发时刻」这类第三种语义
 * 硬塞进了「场次」。后果不在铁律一原本那两个方向里，而是第三种：
 * **把签发时刻当场次 → 界面显示「已逾期」，而真实情况是「还有 3 天」。**
 * 见 CLAUDE.md 铁律一的补充。
 */
type PairKind = "fixed" | "deadline" | "issuance";

/** 句末标点。逗号不算——「10:00，考试时间如上」这种后置标签仍然要认。 */
const SENTENCE_END = /[。！？!?；;\n]/;

/** 子句边界。签发语气词只在本子句内有效，见 classifyPair。 */
const CLAUSE_BOUNDARY = /[，,；;。！？!?\n]/;

/** 把上下文收窄到候选时刻所在的那个子句。 */
function withinClause(ctx: Context): Context {
  let cut = -1;
  for (let i = ctx.prefix.length - 1; i >= 0; i -= 1) {
    if (CLAUSE_BOUNDARY.test(ctx.prefix[i] as string)) {
      cut = i;
      break;
    }
  }
  const stop = ctx.suffix.search(CLAUSE_BOUNDARY);
  return {
    prefix: ctx.prefix.slice(cut + 1),
    suffix: stop === -1 ? ctx.suffix : ctx.suffix.slice(0, stop),
  };
}

function classifyPair(ctx: Context): PairKind {
  /**
   * 时刻后面**紧贴**着「前」，而场次词只出现在更后面：这是截止，不是场次。
   *
   * 「请在 09-21 17:00（回复截止时间）前反馈面试时间」——句尾的「面试时间」是
   * 要用户反馈的那样东西，不是这个 17:00 的标签。场次标签的常态是写在时刻
   * **前面**（「面试时间：…」），所以前缀里有场次词时仍然按场次算，铁律一不动。
   */
  if (CN_BEFORE_AFTER_TIME.test(ctx.suffix) && !START_MARK.test(ctx.prefix)) return "deadline";
  // 场次语气词最优先：错过考试不可挽回（铁律一）。
  // 后缀只看到本句句末为止：「报名截止 09-26 12:00。考试时间：09-28 10:00」里，
  // 句号后面的「考试时间」是下一个时刻的标签，不是前一个的。
  const sentenceEnd = ctx.suffix.search(SENTENCE_END);
  const ownSuffix = sentenceEnd === -1 ? ctx.suffix : ctx.suffix.slice(0, sentenceEnd);
  if (START_MARK.test(ctx.prefix) || START_MARK.test(ownSuffix)) return "fixed";
  /**
   * 签发/生效：既不是场次也不是期限，应当被跳过让流程继续往下找。
   *
   * 只在候选时刻**自己的子句**里找签发词。真实邮件里最常见的写法是一句话
   * 两个时刻：「邀请于 09-24 09:09 生效，于 10-01 09:09 失效」。按固定字符
   * 窗口看，第二个时刻往前 20 个字里还含着上一个子句的「生效」，于是真正的
   * 截止也被当成签发时刻跳过，最后退回到「只有日期，按当日 23:59 算」——
   * 一个精确到分钟的截止被读晚了十几个小时。
   */
  const clause = withinClause(ctx);
  if (ISSUANCE_MARK.test(clause.prefix) || ISSUANCE_MARK.test(clause.suffix)) return "issuance";
  if (EN_WINDOW_OPEN_MARK.test(ctx.prefix)) return "issuance";
  if (
    CN_DEADLINE_MARK.test(ctx.prefix) ||
    CN_DEADLINE_MARK.test(ctx.suffix) ||
    EN_DEADLINE_MARK.test(ctx.prefix) ||
    CN_BEFORE_AFTER_TIME.test(ctx.suffix)
  ) {
    return "deadline";
  }
  return "fixed";
}

/** 只跟在日期后面的「前」（8月20日前），中文特有。 */
function hasCnBeforeMark(suffix: string): boolean {
  return CN_BEFORE_ONLY.test(suffix.slice(0, 6));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateLabel(d: DateHit): string {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/**
 * 文本 → 时间语义。
 *
 * @param text          邮件主题 + 正文
 * @param receivedAtUtc 收信时刻（UTC ISO），相对期限从它起算
 * @param tz            事件所在地时区（IANA）。正文里写明时区时以正文为准
 * @param focusText     可选。模型圈出的「说时间的那一小段」。给了它，就只从这一段里
 *                      **挑候选时刻**，但判断语气词时仍然看全文里的上下文。
 *
 *                      原先的做法是把这一小段单独拿去分类。模型圈得越准，丢的上下文
 *                      越多：它只圈「2026-09-21 17:00」，后面那个「前反馈」就看不见了，
 *                      截止被读成场次。圈选的价值在于「别去看页脚和签名里的无关时间」，
 *                      不在于把语气词也一起裁掉。
 */
export function classifyDue(
  text: string,
  receivedAtUtc: UtcIsoString,
  tz: IanaTimeZone,
  focusText?: string | null,
): DueClassification {
  const raw = normalizeText(text ?? "");
  const focus =
    typeof focusText === "string" && focusText.trim().length > 0
      ? locateFragment(raw, normalizeText(focusText))
      : null;
  // 圈出的片段在全文里定位不到（理论上接地检查已经挡掉了）：退回旧行为，单独分类这一段
  if (focus === null && typeof focusText === "string" && focusText.trim().length > 0) {
    return classifyDue(focusText, receivedAtUtc, tz);
  }
  const explicitTimeZone = findExplicitTimeZone(raw);

  const none = (confidence: Confidence, reason: string): DueClassification => ({
    dueType: "unknown",
    startUtc: null,
    endUtc: null,
    confidence,
    reason,
    explicitTimeZone,
  });

  if (raw.trim().length === 0) return none("low", "空文本");
  if (isVerificationNoise("", raw)) return none("low", "命中验证码/邮箱验证等非求职噪音");

  const receivedMs = Date.parse(receivedAtUtc);
  if (Number.isNaN(receivedMs)) {
    return none("low", `收信时刻不是合法时间：${receivedAtUtc}`);
  }

  // 正文显式写明的时区优先于调用方传入的推断值
  const zone = explicitTimeZone ?? tz;
  const zoneOk = typeof zone === "string" && zone.length > 0 && isValidTimeZone(zone);
  const refDate = zoneOk ? localDateIn(receivedAtUtc, zone) : receivedAtUtc.slice(0, 10);
  const ref = { year: Number(refDate.slice(0, 4)), date: refDate };

  // 候选日期只取与圈选片段有交叠的；钟点不筛——它靠与日期的距离配对，
  // 片段边界切在日期和钟点之间时不该因此丢掉钟点。
  const dates = findDates(raw, ref).filter(
    (d) => focus === null || (d.index < focus.end && d.end > focus.start),
  );
  const times = findTimes(raw);
  const relativeSource = focus === null ? raw : raw.slice(focus.start, focus.end);

  const toUtc = (d: DateHit, hour: number, minute: number): UtcIsoString =>
    wallClockPartsToUtc(
      { year: d.year, month: d.month, day: d.day, hour, minute },
      zone,
    );

  const degrade = (reason: string): DueClassification => ({
    dueType: "date_only",
    startUtc: null,
    endUtc: null,
    confidence: "low",
    reason,
    explicitTimeZone,
  });

  // ---- A. 日期 + 钟点 ----
  const pairs = dates
    .map((date) => ({ date, time: pairDateWithTime(date, times) }))
    .filter((p): p is { date: DateHit; time: TimeHit } => p.time !== null);

  const classified = pairs.map((p) => {
    const start = Math.min(p.date.index, p.time.index);
    const end = Math.max(p.date.end, p.time.end);
    return { ...p, kind: classifyPair(contextAround(raw, start, end)) };
  });

  /**
   * 扫描到什么才停——**这段是下一个人最容易改坏的地方，改之前先读完。**
   *
   * 原先是「抓到第一个候选就 return」，所以一封信里只要前面出现过任何一个
   * 日期+钟点，后面真正的截止就再也没机会被看到（有一封「邀请于 08-16
   * 11:51，于 08-21 11:51 失效」正是栽在这里）。现在改成扫完全部候选再决定，
   * 停止条件按优先级从高到低：
   *
   *   1. 第一个「未来的 fixed」    → fixed_start。铁律一：场次优先于期限，
   *                                 错过考试不可挽回，所以它压过下面的 deadline
   *   2. 第一个 deadline           → deadline
   *   3. 只剩「过去的 fixed」      → **不在这里 return**，记进 deferredPastFixed
   *                                 先放行流程去跑 B1 相对期限 / B2 绝对期限，
   *                                 都没找到才回过头用它（见下方 A' 段）
   *   4. 候选全是 issuance / 没有候选 → 同样不 return，直接落到 B1
   *
   * issuance（签发/生效时刻）在第 0 步就被 filter 掉了，它永远不参与竞争，
   * 但也永远不会被当成"没有信息"——它只是不配当答案。
   */
  const usable = classified.filter((p) => p.kind !== "issuance");

  /** 候选时刻已经 ≤ 收信时刻的 fixed。留着兜底，但不许抢在 B1/B2 前面。 */
  let deferredPastFixed: (typeof usable)[number] | null = null;

  if (usable.length > 0) {
    if (!zoneOk) {
      // 没有时区就无法比较先后（「未来的场次」都判断不了），只按出现顺序挑：场次优先于期限
      const hint = usable.find((p) => p.kind === "fixed") ?? usable.find((p) => p.kind === "deadline") ?? usable[0]!;
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        ...degrade("找到了日期与钟点，但时区未知，无法换算成 UTC"),
        unzoned: {
          local: `${hint.date.year}-${pad(hint.date.month)}-${pad(hint.date.day)}T${pad(hint.time.hour)}:${pad(hint.time.minute)}`,
          kind: hint.kind === "deadline" ? "deadline" : "fixed_start",
        },
      };
    }

    const momentOf = (p: (typeof usable)[number]): number =>
      Date.parse(toUtc(p.date, p.time.hour, p.time.minute));

    /**
     * 不依赖词表的结构判据：**这个时刻就是这封信自己的签发时刻**。
     *
     * 签发时刻天然等于发信那一刻，所以哪怕 ISSUANCE_MARK 漏了某种说法
     * （生效/签发/下发…没有共同结构特征，词表必然有洞），这里也能兜住。
     *
     * ⚠️ 判据是「≈ 收信时刻」而不是「≤ 收信时刻」，这是实测后收窄的：
     * 「≤ 收信时刻」会把仅仅早两小时的场次也一并降级。内部用例
     * 「8/15 10:00 开考，请于 8/13 前确认」（收信 8/15 12:03）就栽在这上面——
     * 场次只过去 2 小时，而对照的「8/13」因为早于参照日被日期解析器滚到了
     * **2027 年**，反而成了"未来的截止"把真场次顶掉。宽判据换来的是把答案
     * 交给一个年份滚动假象，比它要修的 bug 更糟。
     *
     * 收窄之后判据的含义也更准确了：它识别的不是"这个时间过去了"，
     * 而是"这个时间戳是邮件自己的发出时间"——后者才是签发时刻的本质。
     * 容差留给投递延迟与时钟偏差。
     *
     * 只做「不得当选」，不做「一律丢弃」：signature 时刻之外无其他线索时，
     * 仍然按已发生的场次记录，见下方 A' 段。
     */
    const SEND_STAMP_TOLERANCE_MS = 30 * 60_000;
    const isSendStamp = (p: (typeof usable)[number]): boolean => {
      const moment = momentOf(p);
      return moment <= receivedMs && receivedMs - moment <= SEND_STAMP_TOLERANCE_MS;
    };

    const eligibleFixed = usable.find((p) => p.kind === "fixed" && !isSendStamp(p));
    const deadlineHit = usable.find((p) => p.kind === "deadline");
    const picked = eligibleFixed ?? deadlineHit ?? null;

    if (picked) {
      const { date, time } = picked;
      const isDeadline = picked.kind === "deadline";
      return {
        dueType: isDeadline ? "deadline" : "fixed_start",
        startUtc: toUtc(date, time.hour, time.minute),
        endUtc:
          !isDeadline && time.endHour !== null
            ? toUtc(date, time.endHour, time.endMinute ?? 0)
            : null,
        confidence: date.ambiguous ? "low" : "high",
        reason: isDeadline
          ? `期限语气词 + 明确时刻：${dateLabel(date)} ${pad(time.hour)}:${pad(time.minute)}（${zone}）${time.normalizedFromMidnight ? "，24:00 已归一化为当日 23:59" : ""}`
          : `明确场次：${dateLabel(date)} ${pad(time.hour)}:${pad(time.minute)}（${zone}）`,
        explicitTimeZone,
      };
    }

    deferredPastFixed = usable.find((p) => p.kind === "fixed") ?? null;
  }

  /** §A 已经消费掉的日期（它们自带钟点）。B2 是给"没有钟点的日期"用的。 */
  const pairedDateIndexes = new Set(classified.map((p) => p.date.index));

  // ---- B1. 相对期限，自收信时刻起算 ----
  const relative = findRelativeDeadline(relativeSource);
  if (relative && relative.kind === "start") {
    // 提醒邮件推出来的场次：信息保住，但置信度降级进「待确认收件箱」
    return {
      dueType: "fixed_start",
      startUtc: new Date(receivedMs + relative.ms).toISOString(),
      endUtc: null,
      confidence: "low",
      reason: `提醒邮件「${relative.label}」，按收信时刻推算场次；原始邀请可能未入库，需人工确认`,
      explicitTimeZone,
    };
  }
  if (relative) {
    if (relative.businessDays) {
      if (!zoneOk) return degrade("找到工作日期限但时区未知，无法按当地日历跳周末");
      return {
        dueType: "deadline",
        startUtc: addBusinessDays(receivedAtUtc, relative.count, zone),
        endUtc: null,
        confidence: "high",
        reason: `相对期限「${relative.label}」，自收信时刻起算并跳过周末`,
        explicitTimeZone,
      };
    }
    return {
      dueType: "deadline",
      startUtc: new Date(receivedMs + relative.ms).toISOString(),
      endUtc: null,
      confidence: "high",
      reason: `相对期限「${relative.label}」，自收信时刻起算`,
      explicitTimeZone,
    };
  }

  // ---- B2. 绝对期限：日期附近有期限语气词，但没写钟点 ----
  for (const date of dates) {
    const ctx = contextAround(raw, date.index, date.end);
    if (START_MARK.test(ctx.prefix)) continue;
    const enMark = EN_DEADLINE_MARK.test(ctx.prefix);
    const cnMark =
      CN_DEADLINE_MARK.test(ctx.prefix) ||
      CN_DEADLINE_MARK.test(ctx.suffix) ||
      hasCnBeforeMark(ctx.suffix);
    if (!enMark && !cnMark) continue;
    if (!zoneOk) return degrade("找到截止日期但时区未知");

    /**
     * 手上还攥着一个"已经过去的场次"时，只有**未来**的截止才配把它顶掉。
     *
     * 「8/15 10:00 开考，请于 8/13 前确认」这类信里两个时刻都在收信之前，
     * 此时不存在"哪个更值得用户现在行动"的问题，铁律一原样生效：场次赢。
     * 反过来，如果这里的截止在未来（有一封「生效…请在3天内完成」就是
     * 相对期限版的同一情形），它才是用户真正还能行动的那个，该让它赢。
     */
    if (deferredPastFixed) {
      // 这个日期已经在 §A 里跟钟点配过对了，B2 不该再拿它当"无钟点的截止日"
      // 重算一遍——「8/15 10:00 开考」里的 8/15 是场次日期，不是截止日期。
      if (pairedDateIndexes.has(date.index)) continue;
      if (Date.parse(toUtc(date, 23, 59)) <= receivedMs) continue;
    }

    // 英文 by / deadline / closes 语义上含当日；中文「X日前」待产品确认，暂取当日零点
    const endOfDay = enMark || CN_BEFORE_MEANS_END_OF_DAY;
    const hour = endOfDay ? 23 : 0;
    const minute = endOfDay ? 59 : 0;
    // 语义已定案，中英文一致；置信度只反映日期解析本身的确定性
    const confidence: Confidence = date.ambiguous ? "low" : "high";
    const alt = date.alternative;
    return {
      dueType: "deadline",
      startUtc: toUtc(date, hour, minute),
      endUtc: null,
      confidence,
      reason: date.ambiguous && alt
        ? `日/月顺序存在歧义：已取较早的一解 ${dateLabel(date)}，另一解为 ${date.year}-${pad(alt.month)}-${pad(alt.day)}；取早是因为截止取早=早提醒、场次取早=早到场，两个方向都偏安全。需人工确认`
        : `绝对期限 ${dateLabel(date)}${endOfDay ? " 当日结束 23:59" : " 当日零点"}`,
      explicitTimeZone,
    };
  }

  // ---- A'. 兜底：只剩「已经过去的场次」 ----
  //
  // 走到这里说明 B1/B2 都没找到别的期限，那这个过去的场次就是全文唯一的时间信息。
  // 「你错过了 8/20 的考试」这种提醒邮件必须留住它——丢掉等于用户完全看不到这封信
  // 说了什么。但它排在 B1/B2 之后：真有未来的期限时，那个才是用户现在能行动的。
  if (deferredPastFixed) {
    const { date, time } = deferredPastFixed;
    return {
      dueType: "fixed_start",
      startUtc: toUtc(date, time.hour, time.minute),
      endUtc:
        time.endHour !== null ? toUtc(date, time.endHour, time.endMinute ?? 0) : null,
      // 置信度只反映"这个时刻解析得准不准"，不反映"它是不是已经过去了"——
      // 后者是事实本身，已经写在 startUtc 里，展示层自己看得见，
      // 再往置信度上叠一次等于同一件事罚两遍。
      confidence: date.ambiguous ? "low" : "high",
      reason: `明确场次：${dateLabel(date)} ${pad(time.hour)}:${pad(time.minute)}（${zone}）；该时刻在收信时已经过去，且全文没有更晚的期限，按已发生的场次原样记录`,
      explicitTimeZone,
    };
  }

  // ---- C. 只有日期 ----
  const firstDate = dates[0];
  if (firstDate) {
    if (!zoneOk) return degrade("只有日期且时区未知");
    return {
      dueType: "date_only",
      startUtc: toUtc(firstDate, 0, 0),
      endUtc: null,
      confidence: firstDate.ambiguous ? "low" : "medium",
      reason: `只找到日期 ${dateLabel(firstDate)}，无钟点`,
      explicitTimeZone,
    };
  }

  return none("low", "文本中没有任何可用的时间信息");
}

/**
 * classifyDue 的信号驱动版：不要求调用方已经知道时区，自己先推断再分类。
 *
 * 用于「时区本身也是未知数」的真实场景（收信入库时）。已经确定时区的调用方
 * 继续用 classifyDue(text, receivedAt, tz)，不必绕这一层。
 *
 * 推断不出时区时的行为：
 * - 相对期限（"72小时内"）本身就不依赖时区，照常算出——classifyDue 内部对
 *   非工作日的相对期限从不检查 zoneOk，这里传空字符串不会改变那条路径。
 * - 绝对时刻（"8月15日10:00"）需要时区才能换算成 UTC，classifyDue 会自动
 *   降级为 date_only 或 unknown，reason 里写明「时区未知，无法换算」。
 *   这一层不重复判断，直接把 inferTimeZone 的结论传给 classifyDue 即可。
 */
export function classifyDueFromSignals(
  signals: TimeZoneSignals,
  receivedAtUtc: UtcIsoString,
): DueClassification & { tzInference: TimeZoneInference } {
  const tzInference = inferTimeZone(signals);
  const result = classifyDue(signals.text, receivedAtUtc, tzInference.tz ?? "");
  return { ...result, tzInference };
}

/** 精度排序，合并时取高的。 */
export const DUE_TYPE_PRECISION: Readonly<Record<DueType, number>> = {
  fixed_start: 4,
  deadline: 3,
  date_only: 2,
  unknown: 1,
};

export { normalizeText, CN_NUM, parseCount };
