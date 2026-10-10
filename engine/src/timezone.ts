import type { Confidence, IanaTimeZone, UtcIsoString } from "./types.js";
import {
  COMPANY_DOMAIN_REGIONS,
  DOMESTIC_ATS_DOMAINS,
  INTERNATIONAL_ATS_DOMAINS,
  UNKNOWN_REGION_ATS_DOMAINS,
  extractDomain,
  matchesDomain,
  topLevelDomain,
} from "./domains.js";

/**
 * 时区换算全部走 Intl.DateTimeFormat 的 timeZone 选项。
 * 夏令时交给 ICU 数据处理，不手写偏移量加减——
 * 手写偏移在 DST 切换日必错，而那正是最容易让人错过面试的日子。
 */

/**
 * 地区描述 → IANA 时区。城市名也收在这里，只此一张表——
 * 另起一张「地点表」必然与它漂移，而漂移的后果是同一个词在两处解析成不同时区。
 */
const REGION_MAP: ReadonlyArray<readonly [readonly string[], IanaTimeZone]> = [
  [
    [
      "国内", "中国", "中国大陆", "大陆", "china", "cn", "mainland china",
      "chinese mainland", "mainland", "prc",
      "北京", "上海", "深圳", "广州", "杭州", "成都", "南京", "武汉", "苏州", "西安",
      "beijing", "shanghai", "shenzhen", "guangzhou", "hangzhou", "chengdu",
    ],
    "Asia/Shanghai",
  ],
  [["香港", "港", "hong kong", "hongkong", "hk"], "Asia/Hong_Kong"],
  [["新加坡", "狮城", "singapore", "sg"], "Asia/Singapore"],
  [["中东", "迪拜", "阿联酋", "middle east", "dubai", "uae"], "Asia/Dubai"],
  [
    [
      "美国", "美", "us", "usa", "united states", "america", "纽约", "new york", "nyc",
      "波士顿", "boston", "华盛顿", "washington, d.c.", "washington dc", "atlanta", "philadelphia",
    ],
    "America/New_York",
  ],
  [["芝加哥", "chicago", "休斯顿", "houston"], "America/Chicago"],
  [["丹佛", "denver"], "America/Denver"],
  [
    [
      "旧金山", "san francisco", "湾区", "bay area", "洛杉矶", "los angeles", "西雅图", "seattle",
      "san jose", "palo alto", "mountain view",
    ],
    "America/Los_Angeles",
  ],
  [["多伦多", "toronto"], "America/Toronto"],
  [["悉尼", "sydney"], "Australia/Sydney"],
  [["东京", "tokyo"], "Asia/Tokyo"],
  [["欧洲", "英国", "伦敦", "europe", "uk", "united kingdom", "london", "britain"], "Europe/London"],
];

/**
 * 不参与自由文本扫描的别名。
 *
 * 这些是极短或极常见的词：英文邮件里的 "us"（contact us）、"美"、"港"、"大陆"
 * 都会大量误命中。它们作为**显式传入**的地区名仍然有效
 * （regionToTimeZone("US") 照常工作），只是不拿去在正文里搜。
 */
const NOT_TEXT_SCANNABLE = new Set([
  "us", "cn", "sg", "hk", "uk", "美", "港", "大陆", "mainland", "prc", "america",
]);

/**
 * 地区 → 时区。认不出来返回 null。
 *
 * 刻意不默认成 Asia/Shanghai：默认一个错的时区比承认不知道危险得多——
 * 用户会看到一个自信但错误的时刻，而不是「时区待确认」的提示。
 */
export function regionToTimeZone(region: string): IanaTimeZone | null {
  const key = region.trim().toLowerCase();
  if (key.length === 0) return null;
  for (const [aliases, zone] of REGION_MAP) {
    if (aliases.includes(key)) return zone;
  }
  return null;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: IanaTimeZone): Intl.DateTimeFormat {
  const cached = offsetFormatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  offsetFormatters.set(timeZone, created);
  return created;
}

/** 某个 UTC 时刻在某时区的偏移（分钟）。用 Intl 反解，不做手工加减。 */
export function zoneOffsetMinutes(date: Date, timeZone: IanaTimeZone): number {
  const parts = offsetFormatter(timeZone).formatToParts(date);
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
 * 在自由文本里找地点词。
 *
 * 拉丁字母的别名要求词边界，中日韩字符直接子串匹配（中文没有词边界）。
 * 命中多个时取文本中出现最早的那个，保证结果确定。
 */
export function findLocationTimeZone(
  text: string,
): { zone: IanaTimeZone; matched: string } | null {
  const lower = text.toLowerCase();
  let best: { zone: IanaTimeZone; matched: string; index: number } | null = null;

  for (const [aliases, zone] of REGION_MAP) {
    for (const alias of aliases) {
      if (NOT_TEXT_SCANNABLE.has(alias)) continue;
      const index = /^[\x00-\x7F]+$/.test(alias)
        ? indexOfWord(lower, alias)
        : lower.indexOf(alias);
      if (index < 0) continue;
      if (best === null || index < best.index) best = { zone, matched: alias, index };
    }
  }

  return best === null ? null : { zone: best.zone, matched: best.matched };
}

/** 带词边界的子串查找，避免 "us" 命中 "using"。 */
function indexOfWord(haystack: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).exec(haystack);
  return match ? match.index : -1;
}

/** 校验是不是 Intl 认得的 IANA 时区名。 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

/**
 * 「某时区的墙上时间」→ UTC ISO。
 *
 * 迭代两次是为了处理 DST 切换日：第一次用「猜测时刻」的偏移换算，
 * 结果可能落在偏移变化的另一侧，第二次用修正后的时刻重取偏移。
 */
export function wallClockPartsToUtc(
  wall: WallClock,
  timeZone: IanaTimeZone,
): UtcIsoString {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second ?? 0,
  );
  let ms = naive;
  for (let i = 0; i < 2; i += 1) {
    ms = naive - zoneOffsetMinutes(new Date(ms), timeZone) * 60_000;
  }
  return new Date(ms).toISOString();
}

/** "2026-08-15 10:00" / "2026-08-15T10:00:00" / "2026-08-15" 都接受。 */
export function parseWallClock(wall: string): WallClock | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    wall.trim(),
  );
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
  };
}

/**
 * 墙上时间字符串 → UTC ISO。解析不了就抛——
 * 静默返回一个错的时刻比抛错危险得多。
 */
export function wallClockToUtc(wall: string, tz: IanaTimeZone): UtcIsoString {
  const parts = parseWallClock(wall);
  if (!parts) throw new Error(`无法解析墙上时间：${wall}`);
  if (!isValidTimeZone(tz)) throw new Error(`不是合法的 IANA 时区名：${tz}`);
  return wallClockPartsToUtc(parts, tz);
}

/** 某 UTC 时刻在某时区的日历日，YYYY-MM-DD。跨时区判「哪一天」必须用它。 */
export function localDateIn(utc: UtcIsoString, timeZone: IanaTimeZone): string {
  const date = new Date(utc);
  const shifted = new Date(date.getTime() + zoneOffsetMinutes(date, timeZone) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

const labelFormatters = new Map<string, Intl.DateTimeFormat>();

function labelFormatter(timeZone: IanaTimeZone): Intl.DateTimeFormat {
  const cached = labelFormatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
  labelFormatters.set(timeZone, created);
  return created;
}

/**
 * 时区缩写单独取。CLDR 只在「本地区」的 locale 里给字母缩写：
 * en-US 下 Europe/London 只能拿到 GMT+1，en-GB 下才是 BST；
 * 反过来 en-GB 下 America/New_York 会退化成 GMT-4。
 * 所以按候选链取第一个不是 GMT±N 形式的结果。
 */
const ABBR_LOCALES = ["en-US", "en-GB"] as const;
const OFFSET_LIKE = /^(GMT|UTC)([+-]|$)/;

export function zoneAbbr(utc: UtcIsoString, timeZone: IanaTimeZone): string {
  const date = new Date(utc);
  let fallback: string | null = null;
  for (const locale of ABBR_LOCALES) {
    const value = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!value) continue;
    if (!OFFSET_LIKE.test(value)) return value;
    fallback ??= value;
  }
  return fallback ?? timeZone;
}

export interface DualDisplay {
  /** 事件所在地的显示串。 */
  source: string;
  /** 观察者所在地的显示串。同区时与 source 相同。 */
  viewer: string;
  /** 两个时区是否等价。true 时 UI 不应重复渲染。 */
  sameZone: boolean;
}

/**
 * 双时区显示。这是方案的核心痛点：
 * 「8月15日上午10点笔试」对纽约用户实际是 8月14日晚 22 点，差一整天。
 */
export function formatDual(
  utc: UtcIsoString,
  sourceTz: IanaTimeZone,
  viewerTz: IanaTimeZone,
): DualDisplay {
  const render = (zone: IanaTimeZone): string =>
    `${labelFormatter(zone).format(new Date(utc)).replace(/\s+[A-Z]{1,5}[+-]?\d*$/, "")} ${zoneAbbr(utc, zone)}`;
  const same = isSameZone(utc, sourceTz, viewerTz);
  const source = render(sourceTz);
  return { source, viewer: same ? source : render(viewerTz), sameZone: same };
}

/** 同名，或该时刻偏移与缩写都一致，视为同一时区（如 Asia/Shanghai 与 Asia/Chongqing）。 */
export function isSameZone(
  utc: UtcIsoString,
  a: IanaTimeZone,
  b: IanaTimeZone,
): boolean {
  if (a === b) return true;
  const date = new Date(utc);
  return (
    zoneOffsetMinutes(date, a) === zoneOffsetMinutes(date, b) &&
    zoneAbbr(utc, a) === zoneAbbr(utc, b)
  );
}

/**
 * 正文里显式写明的时区 → IANA 名。
 * 缩写映射到时区而非固定偏移，夏令时才由 ICU 正确判定
 * （2026-08-20 的美东实际是 EDT，但发件人一年到头都写 EST）。
 */
const EXPLICIT_ZONES: ReadonlyArray<readonly [RegExp, IanaTimeZone]> = [
  [/北京时间|beijing\s+time|china\s+standard\s+time/i, "Asia/Shanghai"],
  [/新加坡时间|singapore\s+time|\bSGT\b/i, "Asia/Singapore"],
  [/香港时间|hong\s*kong\s+time|\bHKT\b/i, "Asia/Hong_Kong"],
  [/\b(EST|EDT|ET)\b|\bEastern\s+(?:Standard\s+|Daylight\s+)?Time\b/, "America/New_York"],
  [/\b(PST|PDT|PT)\b|\bPacific\s+(?:Standard\s+|Daylight\s+)?Time\b/, "America/Los_Angeles"],
  // ⚠️ 裸的 CST 故意不收：它既是美国中部时间，也是 China Standard Time，
  // 两者差 14 小时。在华外企的英文信里两种都见得到，猜哪个都可能错一整天。
  [/\b(CDT|CT)\b|\bCentral\s+(?:Standard\s+|Daylight\s+)?Time\b/, "America/Chicago"],
  [/\b(MDT|MST)\b|\bMountain\s+(?:Standard\s+|Daylight\s+)?Time\b/, "America/Denver"],
  [/\b(BST|GMT)\b|\b(?:UK|London)\s+time\b/, "Europe/London"],
  [/\b(GST)\b|\bGulf\s+Standard\s+Time\b|\b(?:Dubai|UAE)\s+time\b/, "Asia/Dubai"],
  [/\b(AEST|AEDT)\b|\bSydney\s+time\b/, "Australia/Sydney"],
  [/\b(JST)\b/, "Asia/Tokyo"],
  [/\b(CET|CEST)\b/, "Europe/Berlin"],
];

export function findExplicitTimeZone(text: string): IanaTimeZone | null {
  for (const [pattern, zone] of EXPLICIT_ZONES) {
    if (pattern.test(text)) return zone;
  }
  return null;
}

export interface TimeZoneSignals {
  text: string;
  senderDomain?: string;
  /** 台账里这家公司已有的地区记录。 */
  knownCompanyRegion?: string;
}

export interface TimeZoneInference {
  tz: IanaTimeZone | null;
  confidence: Confidence;
  source: "explicit" | "location" | "domain" | "ledger" | "none";
  /** 命中了哪条线索，便于人工复核。 */
  reason: string;
}

/**
 * 推断事件所在时区。命中即停，严格按优先级。
 *
 * 三条铁律：
 *
 * 1. **绝不因为邮件是英文就推成美国时区。** 四大和外企在华校招全用英文发信，
 *    「某公司(Shenzhen)」「某公司(Chinese Mainland)」这类写法都是实例，判错就是 12 小时误差。
 *    语言在整个优先级链里根本不出现。
 * 2. **绝不兜底成 Asia/Shanghai。** 无线索就返回 null——默认一个错时区比
 *    承认不知道危险得多，用户会看到一个自信但错误的时刻。
 * 3. **国际 ATS 域名不含地域信息。** Greenhouse 的客户遍布全球，
 *    不能因为它是美国公司的产品就推出美东时区。
 */
export function inferTimeZone(signals: TimeZoneSignals): TimeZoneInference {
  const text = signals.text ?? "";

  // P1 正文显式写明的时区，最可靠，压过一切
  const explicit = findExplicitTimeZone(text);
  if (explicit) {
    return {
      tz: explicit,
      confidence: "high",
      source: "explicit",
      reason: `正文显式写明时区 → ${explicit}`,
    };
  }

  // P2 岗位地点词
  const location = findLocationTimeZone(text);
  if (location) {
    return {
      tz: location.zone,
      confidence: "high",
      source: "location",
      reason: `正文出现地点「${location.matched}」→ ${location.zone}`,
    };
  }

  // P3 发件域名
  const domainZone = zoneFromDomain(signals.senderDomain);
  if (domainZone) {
    return {
      tz: domainZone.zone,
      confidence: "medium",
      source: "domain",
      reason: domainZone.reason,
    };
  }

  // P4 台账里这家公司已有的地区
  if (signals.knownCompanyRegion) {
    const fromLedger = regionToTimeZone(signals.knownCompanyRegion);
    if (fromLedger) {
      return {
        tz: fromLedger,
        confidence: "medium",
        source: "ledger",
        reason: `台账记录该公司地区为「${signals.knownCompanyRegion}」→ ${fromLedger}`,
      };
    }
  }

  return {
    tz: null,
    confidence: "low",
    source: "none",
    reason: "没有任何时区线索：正文未写明、无地点词、发件域名不含地域信息、台账无记录",
  };
}

function zoneFromDomain(
  senderDomain: string | undefined,
): { zone: IanaTimeZone; reason: string } | null {
  if (!senderDomain) return null;
  const domain = extractDomain(senderDomain);
  if (domain.length === 0) return null;

  // 国际 ATS 与归属不明的 ATS 一律不产生线索，必须先于其他判断挡掉
  if (matchesDomain(domain, INTERNATIONAL_ATS_DOMAINS)) return null;
  if (matchesDomain(domain, UNKNOWN_REGION_ATS_DOMAINS)) return null;

  if (matchesDomain(domain, DOMESTIC_ATS_DOMAINS)) {
    return {
      zone: "Asia/Shanghai",
      reason: `发件域名 ${domain} 是国内 ATS，其客户绝大多数为国内企业`,
    };
  }

  for (const [hint, region] of COMPANY_DOMAIN_REGIONS) {
    if (domain === hint || domain.endsWith(`.${hint}`)) {
      const zone = regionToTimeZone(region);
      if (zone) return { zone, reason: `发件域名 ${domain} 属已知${region}企业` };
    }
  }

  const tld = topLevelDomain(domain);
  const byTld = regionToTimeZone(tld);
  if (byTld) return { zone: byTld, reason: `顶级域 .${tld} 指向该地区` };

  return null;
}
