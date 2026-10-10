// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
/** 文本归一化与中文数字解析。 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * HTML 实体还原。
 *
 * 接入层把 HTML 转成纯文本时经常漏掉实体，真实邮件里 `面试时间:&nbsp; 10:30`
 * 这种残留很常见。不还原的后果是具体的：`&nbsp;` 六个字符夹在日期和钟点之间，
 * 把两者的间距撑过配对窗口，一个写得清清楚楚的面试时间被读成「只有日期」。
 *
 * 只收几个排版实体和数字实体。认不出的原样保留——宁可留一段乱码，
 * 也不把正文里碰巧长得像实体的东西吃掉。
 */
export function decodeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      // 不间断空格与各类排版空格一律当普通空格
      if (code === 0xa0 || (code >= 0x2000 && code <= 0x200a)) return " ";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** 全角数字、冒号、空格折半，并还原 HTML 实体；中文邮件里全半角混用很常见。 */
export function normalizeText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/\u00a0/g, " ")
    // 零宽字符：邮件模板里常夹在字与字之间，肉眼看不见，却会把「面试时间」这样的词拆开
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .replace(/[．]/g, ".")
    .replace(/[／]/g, "/")
    .replace(/[　]/g, " ");
}

const DIGITS: Readonly<Record<string, number>> = {
  零: 0, 〇: 0,
  一: 1, 壹: 1,
  二: 2, 两: 2, 貳: 2, 贰: 2,
  三: 3, 叁: 3,
  四: 4, 肆: 4,
  五: 5, 伍: 5,
  六: 6, 陆: 6,
  七: 7, 柒: 7,
  八: 8, 捌: 8,
  九: 9, 玖: 9,
};

/**
 * 中文数字 → 阿拉伯数字，覆盖 0–99。
 * 「两」当 2（两周、两天），「十五」= 15，「二十三」= 23。
 * 认不出返回 null，绝不猜。
 */
export function parseChineseNumber(input: string): number | null {
  const s = input.trim();
  if (s.length === 0) return null;
  if (/^\d+$/.test(s)) return Number(s);

  const tenAt = s.indexOf("十");
  if (tenAt === -1) {
    // 纯个位：一 / 两 / 九
    if (s.length !== 1) return null;
    return DIGITS[s] ?? null;
  }

  const head = s.slice(0, tenAt);
  const tail = s.slice(tenAt + 1);
  const tens = head.length === 0 ? 1 : (DIGITS[head] ?? null);
  const ones = tail.length === 0 ? 0 : (DIGITS[tail] ?? null);
  if (tens === null || ones === null) return null;
  if (tens > 9 || ones > 9) return null;
  return tens * 10 + ones;
}

/** 数字或中文数字都接受。 */
export function parseCount(raw: string): number | null {
  return parseChineseNumber(raw);
}

/** 中文数字的字符类，供正则复用。 */
export const CN_NUM = "零〇一壹二两贰貳三叁四肆五伍六陆七柒八捌九玖十";

/** 英文月份名 → 月份号。缩写与全称都收，Sept 是常见非标准写法。 */
export const EN_MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export const EN_MONTH_PATTERN =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** 某个日历日是星期几（0=周日）。按纯日期算，与时区无关。 */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isWeekend(year: number, month: number, day: number): boolean {
  const w = weekdayOf(year, month, day);
  return w === 0 || w === 6;
}
