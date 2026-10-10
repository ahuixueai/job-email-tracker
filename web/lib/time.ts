import type { IanaTimeZone, UtcIsoString } from "@/types";

/**
 * 时区换算全部走 Intl.DateTimeFormat 的 timeZone 选项，
 * 由 ICU 数据自己处理夏令时（EST/EDT 切换），不手写偏移量加减。
 */

export interface ZonedTime {
  /** "8月18日 周二" */
  date: string;
  /** "09:30" */
  time: string;
  /** 时区缩写，如 EST / EDT / PST / GMT */
  abbr: string;
  /** IANA 时区名 */
  zone: IanaTimeZone;
}

const dateFmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(key: string, build: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  const cached = dateFmtCache.get(key);
  if (cached) return cached;
  const created = build();
  dateFmtCache.set(key, created);
  return created;
}

/**
 * 时区缩写以 en-US 为准。
 *
 * 但 CLDR 只在「本地区」的 locale 里给字母缩写：en-US 下 Europe/London 只能拿到
 * GMT+1，而 en-GB 下 America/New_York 又退化成 GMT-4。没有单一 locale 同时给出
 * EST / PST / BST。所以按候选顺序取第一个不是 GMT±N 形式的结果，
 * 全都退化时（如 Asia/Shanghai）保留 en-US 的 GMT+8。
 */
const ABBR_LOCALES = ["en-US", "en-GB"] as const;

/** "GMT+1" / "GMT-04:00" / "UTC+8" 这类偏移量写法，不算真正的缩写。 */
const OFFSET_LIKE = /^(GMT|UTC)([+-]|$)/;

function zoneAbbr(date: Date, timeZone: IanaTimeZone): string {
  let fallback: string | null = null;
  for (const locale of ABBR_LOCALES) {
    const formatter = fmt(`abbr:${locale}:${timeZone}`, () =>
      new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }),
    );
    const value = formatter
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!value) continue;
    if (!OFFSET_LIKE.test(value)) return value;
    fallback ??= value;
  }
  return fallback ?? timeZone;
}

/** 把一个 UTC 时刻投影到指定时区，返回可直接渲染的片段。 */
export function toZonedTime(
  utc: UtcIsoString,
  timeZone: IanaTimeZone,
): ZonedTime {
  const date = new Date(utc);
  const dateFormatter = fmt(`date:${timeZone}`, () =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      month: "long",
      day: "numeric",
      weekday: "short",
    }),
  );
  const timeFormatter = fmt(`time:${timeZone}`, () =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  );
  return {
    date: dateFormatter.format(date),
    time: timeFormatter.format(date),
    abbr: zoneAbbr(date, timeZone),
    zone: timeZone,
  };
}

/**
 * SSR 安全的时间锚点：今天 UTC 零点。
 * 首帧（服务端渲染 + hydration）统一用它当「现在」，两端结果必然一致；
 * 挂载后再切到真实 Date.now()。这是一次 effect 驱动的更新，不是 hydration mismatch。
 */
export function ssrSafeAnchor(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** 用户本机时区，绝不硬编码。仅在浏览器端调用才有意义。 */
export function getLocalTimeZone(): IanaTimeZone {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * 校验一个来路不明的时区字符串。
 *
 * cookie 是用户可编辑的输入，把它直接丢给 Intl 会抛 RangeError 并且是在
 * 服务端渲染期间抛——整页 500。所以先过字符集与长度，再让 Intl 自己认一遍，
 * 不合法一律降级成 null（等同首次访问）。
 */
export function normalizeTimeZone(
  value: string | undefined | null,
): IanaTimeZone | null {
  if (!value || value.length > 64) return null;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(value)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/**
 * 判断两个时区是否是同一个。先比 IANA 名，再退一步比当下的实际偏移，
 * 避免 "Asia/Shanghai" 与 "Asia/Chongqing" 这类别名重复渲染。
 */
export function isSameZone(
  a: IanaTimeZone,
  b: IanaTimeZone,
  at: Date = new Date(),
): boolean {
  if (a === b) return true;
  return zoneOffsetMinutes(at, a) === zoneOffsetMinutes(at, b) &&
    zoneAbbr(at, a) === zoneAbbr(at, b);
}

/** 某时刻在某时区的 UTC 偏移（分钟）。用 Intl 反解，不做手工加减。 */
export function zoneOffsetMinutes(date: Date, timeZone: IanaTimeZone): number {
  const formatter = fmt(`offset:${timeZone}`, () =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  );
  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour") % 24,
    pick("minute"),
    pick("second"),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * 把「某时区的墙上时间」换算成 UTC ISO 字符串。
 * 造数据时用它，避免手写 -04:00 / -05:00 这种会被夏令时打脸的偏移量。
 * 迭代两次以处理 DST 切换日附近的偏移跳变。
 */
export function utcFromZonedWallClock(
  wall: { year: number; month: number; day: number; hour: number; minute?: number },
  timeZone: IanaTimeZone,
): UtcIsoString {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute ?? 0,
  );
  let ms = naive;
  for (let i = 0; i < 2; i += 1) {
    ms = naive - zoneOffsetMinutes(new Date(ms), timeZone) * 60_000;
  }
  return new Date(ms).toISOString();
}

/** 时长，如 "45 分钟" / "1 小时 30 分钟"。 */
export function formatDuration(startUtc: UtcIsoString, endUtc: UtcIsoString): string {
  const minutes = Math.round((Date.parse(endUtc) - Date.parse(startUtc)) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} 分钟`;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分钟`;
}

/** 距开始还有多久的自然语言描述。now 由调用方传入，保持纯函数。 */
export function formatCountdown(startUtc: UtcIsoString, now: number): string {
  const diffMinutes = Math.round((Date.parse(startUtc) - now) / 60_000);
  if (diffMinutes < 0) return "已开始";
  if (diffMinutes < 60) return `${diffMinutes} 分钟后`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days} 天后` : `${Math.floor(days / 7)} 周后`;
}
