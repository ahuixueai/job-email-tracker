// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
/**
 * 从文本里找钟点。
 *
 * 12 小时制转换是这里最容易出致命错误的地方：把「下午2:30」读成 02:30
 * 会让用户整整晚 12 小时，直接错过面试。
 */

export interface TimeHit {
  index: number;
  end: number;
  hour: number;
  minute: number;
  endHour: number | null;
  endMinute: number | null;
  /** 原文写的是 24:00 这类越界写法，已归一化到当日 23:59。 */
  normalizedFromMidnight: boolean;
  form: string;
}

/** 中文时段词 → 小时偏移规则。 */
const CN_MERIDIEM = ["凌晨", "早上", "上午", "中午", "下午", "晚上", "傍晚", "夜里"] as const;
type CnMeridiem = (typeof CN_MERIDIEM)[number];

/**
 * 应用时段词。
 * 「中午12点」= 12:00，「凌晨12点」= 00:00，「下午12点」按 12:00 处理。
 */
export function applyCnMeridiem(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const m = meridiem as CnMeridiem;
  if (m === "凌晨" || m === "夜里") return hour === 12 ? 0 : hour;
  if (m === "早上" || m === "上午") return hour === 12 ? 12 : hour;
  if (m === "中午") return hour < 12 ? hour + 12 : 12;
  // 下午 / 晚上 / 傍晚
  if (hour === 12) return 12;
  return hour < 12 ? hour + 12 : hour;
}

/** 英文 AM/PM：12 AM = 00:00，12 PM = 12:00。 */
export function applyEnMeridiem(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const isPm = /p/i.test(meridiem);
  if (isPm) return hour === 12 ? 12 : hour + 12;
  return hour === 12 ? 0 : hour;
}

const CN_MERIDIEM_PATTERN = CN_MERIDIEM.join("|");
const EN_MERIDIEM_PATTERN = "a\\.?m\\.?|p\\.?m\\.?";

/**
 * 24:00 / 24点 归一化到当日 23:59。
 * 不能变成次日 00:00：那会让「20日24:00截止」显示成 21 日，用户以为还有一天。
 */
function normalizeHour(hour: number, minute: number): {
  hour: number;
  minute: number;
  normalized: boolean;
} {
  if (hour === 24 && minute === 0) return { hour: 23, minute: 59, normalized: true };
  return { hour, minute, normalized: false };
}

export function findTimes(text: string): TimeHit[] {
  const hits: TimeHit[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number): boolean =>
    taken.some(([ts, te]) => s < te && e > ts);
  const add = (hit: TimeHit): void => {
    if (hit.hour > 23 || hit.minute > 59) return;
    taken.push([hit.index, hit.end]);
    hits.push(hit);
  };

  // ---- 1. 冒号钟点，可带中文时段词前缀、英文 AM/PM 后缀、区间 ----
  const colon = new RegExp(
    `(?:(${CN_MERIDIEM_PATTERN})\\s*)?` +
      `(?<!\\d)(\\d{1,2}):(\\d{2})` +
      `(?:\\s*(${EN_MERIDIEM_PATTERN}))?` +
      `(?:\\s*[-–—~～至到]\\s*(\\d{1,2}):(\\d{2})(?:\\s*(${EN_MERIDIEM_PATTERN}))?)?`,
    "gi",
  );
  for (const m of text.matchAll(colon)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const rawHour = Number(m[2]);
    const rawMinute = Number(m[3]);
    if (rawHour > 24 || rawMinute > 59) continue;

    const withCn = applyCnMeridiem(rawHour, m[1]);
    const withEn = applyEnMeridiem(withCn, m[4]);
    const start = normalizeHour(withEn, rawMinute);

    let endHour: number | null = null;
    let endMinute: number | null = null;
    if (m[5] !== undefined && m[6] !== undefined) {
      const rawEnd = Number(m[5]);
      // 区间末端没写时段词时沿用前段的，「下午2:30-4:00」不应变成 02:30-04:00
      const enEnd = m[7] ?? m[4];
      let candidate = applyEnMeridiem(applyCnMeridiem(rawEnd, m[1]), enEnd);
      if (candidate < start.hour && candidate + 12 <= 23) candidate += 12;
      const normalizedEnd = normalizeHour(candidate, Number(m[6]));
      endHour = normalizedEnd.hour;
      endMinute = normalizedEnd.minute;
    }

    add({
      index: m.index,
      end: m.index + m[0].length,
      hour: start.hour,
      minute: start.minute,
      endHour,
      endMinute,
      normalizedFromMidnight: start.normalized,
      form: "冒号钟点",
    });
  }

  // ---- 2. 中文 上午10点 / 下午2点30分 / 8点 ----
  const cnClock = new RegExp(
    `(?:(${CN_MERIDIEM_PATTERN})\\s*)?(?<!\\d)(\\d{1,2})\\s*[点時时](?:\\s*(\\d{1,2})\\s*分)?`,
    "g",
  );
  for (const m of text.matchAll(cnClock)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const rawHour = Number(m[2]);
    if (rawHour > 24) continue;
    const minute = Number(m[3] ?? 0);
    const normalized = normalizeHour(applyCnMeridiem(rawHour, m[1]), minute);
    add({
      index: m.index,
      end: m.index + m[0].length,
      hour: normalized.hour,
      minute: normalized.minute,
      endHour: null,
      endMinute: null,
      normalizedFromMidnight: normalized.normalized,
      form: "中文钟点",
    });
  }

  // ---- 3. 英文整点 at 2 PM / 11 AM ----
  const enClock = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(${EN_MERIDIEM_PATTERN})`, "gi");
  for (const m of text.matchAll(enClock)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const hour = applyEnMeridiem(Number(m[1]), m[2]);
    add({
      index: m.index,
      end: m.index + m[0].length,
      hour,
      minute: 0,
      endHour: null,
      endMinute: null,
      normalizedFromMidnight: false,
      form: "英文整点",
    });
  }

  return hits.sort((a, b) => a.index - b.index);
}
