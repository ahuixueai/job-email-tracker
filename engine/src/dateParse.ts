import { EN_MONTHS, EN_MONTH_PATTERN } from "./text.js";

/**
 * 从文本里找日期。
 *
 * 缺年份时补收信当年；补出来若早于收信日则进位次年
 * （12 月收到的邮件提到 1 月，指的是明年）。
 */

export interface DateHit {
  index: number;
  end: number;
  year: number;
  month: number;
  day: number;
  /** 文本里是否写明了年份。 */
  explicitYear: boolean;
  /**
   * 日月顺序是否存在歧义（如 08/09/2026 美式=8月9日、英式=9月8日）。
   * 有歧义时必须降置信度并把另一解写进 reason，禁止静默选一个。
   */
  ambiguous: boolean;
  /** 歧义时的另一种读法。 */
  alternative: { month: number; day: number } | null;
  /** 命中的形态，用于排障。 */
  form: string;
}

function validMonthDay(month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
  return day <= maxDay;
}

interface Ref {
  year: number;
  /** 收信当地日历日 YYYY-MM-DD，用于判断是否需要进位次年。 */
  date: string;
}

/** 补年份：先用收信当年，早于收信日则进位。 */
function inferYear(ref: Ref, month: number, day: number): number {
  const candidate = `${ref.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return candidate < ref.date ? ref.year + 1 : ref.year;
}

export function findDates(text: string, ref: Ref): DateHit[] {
  const hits: DateHit[] = [];
  const push = (h: DateHit): void => {
    if (validMonthDay(h.month, h.day)) hits.push(h);
  };
  const taken: Array<[number, number]> = [];
  const overlaps = (start: number, end: number): boolean =>
    taken.some(([s, e]) => start < e && end > s);
  const claim = (start: number, end: number): void => {
    taken.push([start, end]);
  };

  // ---- 1. 带年份的数字形态：2026-08-15 / 2026/08/15 / 2026年8月15日 ----
  for (const m of text.matchAll(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/g)) {
    claim(m.index, m.index + m[0].length);
    push({
      index: m.index,
      end: m.index + m[0].length,
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      explicitYear: true,
      ambiguous: false,
      alternative: null,
      form: "ISO",
    });
  }

  // ---- 2. 中文 8月15日 / 8月15号 ----
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const month = Number(m[1]);
    const day = Number(m[2]);
    claim(m.index, m.index + m[0].length);
    push({
      index: m.index,
      end: m.index + m[0].length,
      year: inferYear(ref, month, day),
      month,
      day,
      explicitYear: false,
      ambiguous: false,
      alternative: null,
      form: "中文月日",
    });
  }

  // ---- 3. 英文 August 20, 2026 / Aug 22 / Thursday, August 27 ----
  const monthFirst = new RegExp(
    // (?!\\d) 防止把 "Aug 2026" 里的 20 读成日号
    `\\b(${EN_MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:\\s*,\\s*(\\d{4}))?`,
    "gi",
  );
  for (const m of text.matchAll(monthFirst)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const month = EN_MONTHS[(m[1] ?? "").toLowerCase()];
    if (month === undefined) continue;
    const day = Number(m[2]);
    const year = m[3] === undefined ? inferYear(ref, month, day) : Number(m[3]);
    claim(m.index, m.index + m[0].length);
    push({
      index: m.index,
      end: m.index + m[0].length,
      year,
      month,
      day,
      explicitYear: m[3] !== undefined,
      ambiguous: false,
      alternative: null,
      form: "英文月日",
    });
  }

  // ---- 4. 英文 15 Aug 2026 / 15th August ----
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?\\s+(${EN_MONTH_PATTERN})\\.?(?:\\s+(\\d{4}))?`,
    "gi",
  );
  for (const m of text.matchAll(dayFirst)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const month = EN_MONTHS[(m[2] ?? "").toLowerCase()];
    if (month === undefined) continue;
    const day = Number(m[1]);
    const year = m[3] === undefined ? inferYear(ref, month, day) : Number(m[3]);
    claim(m.index, m.index + m[0].length);
    push({
      index: m.index,
      end: m.index + m[0].length,
      year,
      month,
      day,
      explicitYear: m[3] !== undefined,
      ambiguous: false,
      alternative: null,
      form: "英文日月",
    });
  }

  // ---- 5. 斜杠数字：20/08/2026 / 08/09/2026 / 8/15 ----
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?![\d/])/g)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const resolved = resolveSlashOrder(a, b);
    if (!resolved) continue;
    const year = m[3] === undefined ? inferYear(ref, resolved.month, resolved.day) : Number(m[3]);
    claim(m.index, m.index + m[0].length);
    push({
      index: m.index,
      end: m.index + m[0].length,
      year,
      month: resolved.month,
      day: resolved.day,
      explicitYear: m[3] !== undefined,
      ambiguous: resolved.ambiguous,
      alternative: resolved.alternative,
      form: "斜杠数字",
    });
  }

  // ---- 6. MMDD + 场/期/批：国内 ATS 的场次编号写法 ----
  // 裸 4 位数字歧义太大（2027校招、200559112），必须有量词兜底
  for (const m of text.matchAll(/(?<!\d)(\d{2})(\d{2})(?=\s*[场期批])/g)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const month = Number(m[1]);
    const day = Number(m[2]);
    claim(m.index, m.index + m[0].length);
    push({
      index: m.index,
      end: m.index + m[0].length,
      year: inferYear(ref, month, day),
      month,
      day,
      explicitYear: false,
      ambiguous: false,
      alternative: null,
      form: "MMDD场次",
    });
  }

  return hits.sort((a, b) => a.index - b.index);
}

interface SlashResult {
  month: number;
  day: number;
  ambiguous: boolean;
  alternative: { month: number; day: number } | null;
}

/**
 * A/B 的日月顺序判定。
 *
 * 一方 > 12 时可唯一确定；两者都 ≤ 12 时美式与英式都成立，
 * 此时默认取美式但标记歧义——由上层降置信度并在 reason 里写明两解。
 */
export function resolveSlashOrder(a: number, b: number): SlashResult | null {
  const usValid = validMonthDay(a, b); // a=月 b=日
  const euValid = validMonthDay(b, a); // b=月 a=日
  if (!usValid && !euValid) return null;
  if (usValid && !euValid) {
    return { month: a, day: b, ambiguous: false, alternative: null };
  }
  if (!usValid && euValid) {
    return { month: b, day: a, ambiguous: false, alternative: null };
  }
  // 两解都成立时取日历上更早的那个：截止取早等于早提醒，场次取早等于早到场，
  // 两个方向都偏安全。同时标记 ambiguous，由上层降置信度并写明另一解。
  const usEarlier = a < b || (a === b);
  return usEarlier
    ? { month: a, day: b, ambiguous: true, alternative: { month: b, day: a } }
    : { month: b, day: a, ambiguous: true, alternative: { month: a, day: b } };
}
