// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
import type { IanaTimeZone, UtcIsoString } from "./types";
import { CN_NUM, isWeekend, parseCount } from "./text";
import { localDateIn, wallClockPartsToUtc, zoneOffsetMinutes } from "./timezone";

/**
 * 相对期限：「72小时内」「3个工作日内」「expires in 5 business days」。
 *
 * 从收信时刻起算是正确行为，不是编造——baseline 报告第 0 节专门纠正过一次误判。
 */

export interface RelativeHit {
  /** 换算成毫秒的时长。工作日期限不用它，改用 count。 */
  ms: number;
  /** 工作日期限的天数。 */
  count: number;
  /** 是否需要跳过周末。 */
  businessDays: boolean;
  /**
   * deadline = 截止期限（在此之前完成即可）
   * start    = 事件开始时刻（"your interview starts in 24 hours"）
   *
   * 后者是从提醒邮件里推出来的绝对时刻，不是原始邀请，所以置信度要降级。
   */
  kind: "deadline" | "start";
  label: string;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

const NUM = `[0-9${CN_NUM}]{1,3}`;

/** 中文：72小时内 / 三天内 / 两周内 / 3个工作日内 / 5个自然日内 */
const CN_PATTERNS: ReadonlyArray<readonly [RegExp, "hour" | "day" | "week" | "business"]> = [
  [new RegExp(`(${NUM})\\s*(?:个)?\\s*(?:小时|钟头)\\s*(?:以|之)?内`, "g"), "hour"],
  [new RegExp(`(${NUM})\\s*(?:个)?\\s*(?:工作日|个工作日)\\s*(?:以|之)?内`, "g"), "business"],
  [new RegExp(`(${NUM})\\s*(?:个)?\\s*(?:自然日|天|日)\\s*(?:以|之)?内`, "g"), "day"],
  [new RegExp(`(${NUM})\\s*(?:个)?\\s*(?:周|星期|礼拜)\\s*(?:以|之)?内`, "g"), "week"],
];

/**
 * 中文的另外两种说法，都是「从现在起还剩多久」：
 *   「即将在 24小时后截止」「3天后失效」        —— N + 单位 + 后 + 截止类动词
 *   「测评有效期为 5 个自然日」「链接有效期：72小时」—— 有效期 + N + 单位
 *
 * 单位刻意不含「分钟」：「短信验证码有效期为 5 分钟」说的是验证码，不是这件事的期限。
 */
const CN_UNIT = "小时|钟头|工作日|自然日|天|日|周|星期|礼拜";
const CN_AFTER_CLOSES = new RegExp(
  `(${NUM})\\s*(?:个)?\\s*(${CN_UNIT})\\s*(?:之|以)?后\\s*(?:截止|失效|过期|到期|关闭|结束)`,
  "g",
);
const CN_VALID_FOR = new RegExp(
  `有效期\\s*(?:为|是|共|[:：])?\\s*(${NUM})\\s*(?:个)?\\s*(${CN_UNIT})`,
  "g",
);

function cnUnitKind(unit: string): "hour" | "day" | "week" | "business" {
  if (unit === "小时" || unit === "钟头") return "hour";
  if (unit === "工作日") return "business";
  if (unit === "周" || unit === "星期" || unit === "礼拜") return "week";
  return "day";
}

/**
 * 英文期限。
 *
 * 「within N …」无歧义，直接算；
 * 「in N …」必须有期限动词兜底——"your interview starts in 24 hours" 说的是
 * 事件开始而不是截止，不能当 deadline（对应用例 c083）。
 */
const EN_WITHIN = /\bwithin\s+(\d{1,3})\s*(business\s+day|working\s+day|day|hour|hr|week)s?\b/gi;
const EN_EXPIRES_IN =
  /\b(?:expires?|expiring|closes?|closing|due|ends?)\s+in\s+(\d{1,3})\s*(business\s+day|working\s+day|day|hour|hr|week)s?\b/gi;
const EN_BARE_IN = /\bin\s+(\d{1,3})\s*(business\s+day|working\s+day|day|hour|hr|week)s?\b/gi;
/** 「You have 10 days to complete the assessment」：直接对着收件人说的期限。 */
const EN_YOU_HAVE =
  /\byou(?:\s+will|['’]ll)?\s+have\s+(\d{1,3})\s*(business\s+day|working\s+day|day|hour|hr|week)s?\s+to\b/gi;
const EN_FROM_RECEIPT =
  /\b(\d{1,3})\s*(business\s+day|working\s+day|day|hour|hr|week)s?\s+from\s+(?:receipt|the\s+date\s+of\s+this\s+email|this\s+email)/gi;

/** 「in N days」前面是 start/begin 时说的是开始，不是截止。 */
const START_VERB = /\b(start|starts|starting|begin|begins|beginning|commences?)\s*$/i;
/**
 * 事件将在 N 小时后开始。
 *
 * 这类提醒邮件本身不含绝对时刻，但收信时刻 + N 就是。丢弃它的代价是：
 * 方案 4.1 节的召回率目标只有 >70%，约三成情况下原始邀请压根没入库，
 * 此时用户什么都得不到。所以算出来但标 low，进「待确认收件箱」。
 */
const EN_STARTS_IN =
  /\b(?:starts?|starting|begins?|beginning|commences?)\s+in\s+(\d{1,3})\s*(business\s+day|working\s+day|day|hour|hr|week)s?\b/gi;
/** 「in N days」要成立，全文得有期限语气词。 */
const EN_DEADLINE_HINT = /\b(expires?|closes?|closing|deadline|due|complete|submit|respond|confirm)\b/i;

/**
 * 子句边界。归属判断必须在**子句**级，不能在整句级——
 * 有一封信里「…请关注某某招聘公众号，如果您有任何问题，也欢迎通过邮箱咨询，
 * 我们将在3个工作日内为您解答。」整句里是有「请」的（请关注公众号），
 * 按整句判会把客服承诺误认成用户指令。切到子句才能隔离出「我们将在…为您解答」。
 */
const CLAUSE_SPLIT = /[。！？；;，,、\n]/;

/**
 * 用户指令词。真值集里 11 条 deadline 正样本无一例外都带其中之一，
 * 出现即认定这条期限是给用户的——**压过下面的发送方主语判断**，
 * 「我们建议您在48小时内完成」这种混合句式要判给用户。
 */
const USER_DIRECTIVE = /请|务必|需要|需在|需于|应在|应于|建议您|建议你|您需|你需/;

/**
 * 发送方作主语：这个时间说的是招聘方自己的动作（多为客服响应承诺），不是用户的期限。
 * 「我们将在3个工作日内为您解答」= 客服多久回你，不是你多久要交东西。
 */
const SENDER_SUBJECT = /我们|我方|客服|工作人员|专员|招聘团队|人事|小助手|客户经理/;

/** 取 index 所在的子句。 */
function clauseAt(text: string, index: number): string {
  let start = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (CLAUSE_SPLIT.test(text[i] as string)) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = index; i < text.length; i += 1) {
    if (CLAUSE_SPLIT.test(text[i] as string)) {
      end = i;
      break;
    }
  }
  return text.slice(start, end);
}

/**
 * 这条相对期限是不是**用户的**期限。
 *
 * 三层，顺序不能换：
 *   1. 子句里有用户指令词          → 是。显式指令压过一切
 *   2. 否则子句里有发送方主语      → 不是。这是招聘方自己的时间表
 *   3. 否则                        → 是。中文祈使句省略主语时默认对着收件人，
 *                                    「48小时内完成」这种片段式表述属于这一类
 *
 * 第 3 层是必须的：外部用例集里 c004 / c006 / c008 / c040 / c041 / c042
 * 六条都是省略主语的真期限片段，只按第 1 层"必须有指令词"会把它们全判掉。
 */
function belongsToUser(text: string, index: number): boolean {
  const clause = clauseAt(text, index);
  if (USER_DIRECTIVE.test(clause)) return true;
  if (SENDER_SUBJECT.test(clause)) return false;
  return true;
}

function unitToHit(
  count: number,
  unit: string,
  label: string,
  kind: "deadline" | "start" = "deadline",
): RelativeHit | null {
  const u = unit.toLowerCase();
  if (u.startsWith("business") || u.startsWith("working")) {
    return { ms: count * DAY, count, businessDays: true, kind, label };
  }
  if (u.startsWith("hour") || u.startsWith("hr")) {
    return { ms: count * HOUR, count, businessDays: false, kind, label };
  }
  if (u.startsWith("week")) {
    return { ms: count * 7 * DAY, count: count * 7, businessDays: false, kind, label };
  }
  return { ms: count * DAY, count, businessDays: false, kind, label };
}

export function findRelativeDeadline(text: string): RelativeHit | null {
  const found: RelativeHit[] = [];

  for (const [pattern, kind] of CN_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const count = parseCount(m[1] ?? "");
      if (count === null || count <= 0) continue;
      // 主语不是用户的，跳过——那是招聘方自己的时间表，不是你的截止
      if (!belongsToUser(text, m.index)) continue;
      const label = m[0];
      const asDeadline = { count, businessDays: false, kind: "deadline" as const, label };
      if (kind === "hour") found.push({ ...asDeadline, ms: count * HOUR });
      else if (kind === "business")
        found.push({ ...asDeadline, ms: count * DAY, businessDays: true });
      else if (kind === "week")
        found.push({ ...asDeadline, ms: count * 7 * DAY, count: count * 7 });
      else found.push({ ...asDeadline, ms: count * DAY });
    }
  }

  for (const pattern of [CN_AFTER_CLOSES, CN_VALID_FOR]) {
    for (const m of text.matchAll(pattern)) {
      const count = parseCount(m[1] ?? "");
      if (count === null || count <= 0) continue;
      if (!belongsToUser(text, m.index)) continue;
      const kind = cnUnitKind(m[2] ?? "天");
      const base = { count, businessDays: false, kind: "deadline" as const, label: m[0] };
      if (kind === "hour") found.push({ ...base, ms: count * HOUR });
      else if (kind === "business") found.push({ ...base, ms: count * DAY, businessDays: true });
      else if (kind === "week") found.push({ ...base, ms: count * 7 * DAY, count: count * 7 });
      else found.push({ ...base, ms: count * DAY });
    }
  }

  for (const pattern of [EN_WITHIN, EN_EXPIRES_IN, EN_FROM_RECEIPT, EN_YOU_HAVE]) {
    for (const m of text.matchAll(pattern)) {
      const hit = unitToHit(Number(m[1]), m[2] ?? "day", m[0]);
      if (hit) found.push(hit);
    }
  }

  if (EN_DEADLINE_HINT.test(text)) {
    for (const m of text.matchAll(EN_BARE_IN)) {
      // 前面是 starts / begins 的，说的是事件开始时刻，不是截止
      if (START_VERB.test(text.slice(Math.max(0, m.index - 14), m.index))) continue;
      const hit = unitToHit(Number(m[1]), m[2] ?? "day", m[0]);
      if (hit) found.push(hit);
    }
  }

  // 「事件 N 小时后开始」单独收集：它给的是场次不是期限
  const starts: RelativeHit[] = [];
  for (const m of text.matchAll(EN_STARTS_IN)) {
    const hit = unitToHit(Number(m[1]), m[2] ?? "hour", m[0], "start");
    if (hit) starts.push(hit);
  }

  // 场次优先：不可错过的那个赢，与 fixed_start 优先于 deadline 同一条原则
  if (starts.length > 0) return starts.reduce((a, b) => (a.ms <= b.ms ? a : b));
  if (found.length === 0) return null;
  // 多个期限并存时取最紧的，宁可早提醒
  return found.reduce((a, b) => (a.ms <= b.ms ? a : b));
}

/**
 * 按当地日历推进 N 个工作日，保留原本的钟点。
 *
 * 「3个工作日内」从周四起算是下周二，不是周日——按自然日算会把用户
 * 的截止提前两天，或者更糟，让他以为周末也能提交。
 */
export function addBusinessDays(
  fromUtc: UtcIsoString,
  days: number,
  timeZone: IanaTimeZone,
): UtcIsoString {
  const localDate = localDateIn(fromUtc, timeZone);
  const base = new Date(fromUtc);
  const shifted = new Date(base.getTime() + zoneOffsetMinutes(base, timeZone) * 60_000);
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();

  let year = Number(localDate.slice(0, 4));
  let month = Number(localDate.slice(5, 7));
  let day = Number(localDate.slice(8, 10));

  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
    if (!isWeekend(year, month, day)) remaining -= 1;
  }

  return wallClockPartsToUtc({ year, month, day, hour, minute }, timeZone);
}
