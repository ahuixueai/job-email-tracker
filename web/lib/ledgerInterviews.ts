import type { Interview, IanaTimeZone } from "@/types";
import { utcFromZonedWallClock } from "@/lib/time";

/**
 * 把 ledger.db 的 applications 行变成看板能渲染的 Interview。
 *
 * 选取口径与时间/时区推断**逐条对齐 `scripts/export_ics.py`**，不是另起一套：
 * 两边如果算出不同的事件条数或不同的时间，用户会直接懵——日历和看板本该是
 * 同一份台账的两个视图。任何一条规则要改，先改 export_ics.py 再回来对齐这里，
 * 或者反过来，但不能只改一边。
 */

/** applications 表里，构建面试卡片用得到的那几列。对应 export_ics.py 的 SQL 列。 */
export interface LedgerAppRow {
  id: number;
  company: string | null;
  role: string | null;
  region: string | null;
  status: string;
  next_due: string | null;
  deadline: string | null;
  next_action: string | null;
}

/** 只导「在推进」的三种状态，与 export_ics.py 的 LIVE_STATUS 完全一致。 */
export const LIVE_STATUS = ["oa", "applied", "phone"] as const;

/** 所有 ledger 来源的面试统一挂在这个子日历下，id 必须稳定（供 dedup 与显示复用）。 */
export const LEDGER_SUB_CALENDAR_ID = "cal-ledger";

const TZ_UNSURE_MARK = "时区待确认";
const OVERDUE_MARK = "已逾期";

const TZ_FALLBACK: IanaTimeZone = "Asia/Shanghai";

/**
 * 关键词 → 时区。逐条对齐 export_ics.py 的 `_TZ_RULES`，
 * 包括「香港也映射到 Asia/Singapore」这个初看奇怪、实为两边一致的选择
 * （两者都是 UTC+8 且无夏令时，功能等价）——这里不「顺手修正」。
 */
const TZ_RULES: ReadonlyArray<readonly [readonly string[], IanaTimeZone]> = [
  [
    ["国内", "中国", "China", "china", "大陆", "深圳", "北京", "上海", "广州", "杭州", "成都"],
    "Asia/Shanghai",
  ],
  [["新加坡", "香港", "Singapore", "Hong Kong", "HK"], "Asia/Singapore"],
  [["中东", "迪拜", "Dubai", "UAE", "阿联酋"], "Asia/Dubai"],
  [["美国", "US", "USA", "纽约", "New York"], "America/New_York"],
];

/** 岗位地区 → (时区, 是否推断得出)。推不出来时仍给上海，但调用方必须把这件事显示出来。 */
export function tzOf(region: string | null | undefined): {
  tz: IanaTimeZone;
  tzOk: boolean;
} {
  const r = (region ?? "").trim();
  if (r) {
    for (const [keys, tz] of TZ_RULES) {
      if (keys.some((k) => r.includes(k))) return { tz, tzOk: true };
    }
  }
  return { tz: TZ_FALLBACK, tzOk: false };
}

type ParsedWhen =
  | { kind: "none" }
  | { kind: "timed"; utcMs: number }
  | { kind: "date"; year: number; month: number; day: number };

// 带显式偏移："2026-08-23T14:00:00+08:00" 或 "+0800"，两种写法都接受。
const AWARE_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?([+-])(\d{2}):?(\d{2})$/;
// 有钟点、无时区：按传入的 tz 解释。
const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
// 只有日期。
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * 解析一个时间字段。三种结果对齐 export_ics.py 的 parse_when：
 * timed（有具体钟点）/ date（只有日期，全天）/ none（解析不出来，如「2026年8月起网申」）。
 */
export function parseWhen(raw: string | null | undefined, tz: IanaTimeZone): ParsedWhen {
  if (raw == null) return { kind: "none" };
  const t = raw.trim().replace(/\//g, "-");
  if (!t) return { kind: "none" };

  const aware = AWARE_RE.exec(t);
  if (aware) {
    const [, y, mo, d, h, mi, s, sign, oh, om] = aware;
    const offsetMin = (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om));
    const utcMs =
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0) -
      offsetMin * 60_000;
    return { kind: "timed", utcMs };
  }

  const naive = NAIVE_RE.exec(t);
  if (naive) {
    const [, y, mo, d, h, mi, s] = naive;
    const utcMs =
      Date.parse(
        utcFromZonedWallClock(
          { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi) },
          tz,
        ),
      ) + (s ? Number(s) * 1000 : 0);
    return { kind: "timed", utcMs };
  }

  const dateOnly = DATE_RE.exec(t.slice(0, 10));
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return { kind: "date", year: Number(y), month: Number(mo), day: Number(d) };
  }
  return { kind: "none" };
}

export interface PickedWhen {
  source: "next_due" | "deadline";
  raw: string;
  kind: "timed" | "date";
  /** 时刻（epoch ms）。date 类型时是那一天在 tz 下的 00:00。 */
  dt: number;
  overdue: boolean;
}

/**
 * 两个时间字段里挑一个当事件时间，对齐 export_ics.py 的 pick_when：
 *
 *   两个都在未来 → 取更早的那个（截止日优先于软性 next_due，不能让提醒晚于硬截止）
 *   更早的已过期 → 用还在未来的那个
 *   两个都过期   → 取最近的那个，标「已逾期」，不静默丢弃
 */
export function pickWhen(
  nextDue: string | null | undefined,
  deadline: string | null | undefined,
  tz: IanaTimeZone,
  nowMs: number,
): PickedWhen | null {
  const cands: Array<Omit<PickedWhen, "overdue">> = [];
  const fields: ReadonlyArray<readonly ["next_due" | "deadline", string | null | undefined]> = [
    ["next_due", nextDue],
    ["deadline", deadline],
  ];
  for (const [source, raw] of fields) {
    if (raw == null || !raw.trim()) continue;
    const parsed = parseWhen(raw, tz);
    if (parsed.kind === "none") continue;
    if (parsed.kind === "timed") {
      cands.push({ source, raw: raw.trim(), kind: "timed", dt: parsed.utcMs });
    } else {
      const dayStartMs = Date.parse(
        utcFromZonedWallClock(
          { year: parsed.year, month: parsed.month, day: parsed.day, hour: 0, minute: 0 },
          tz,
        ),
      );
      cands.push({ source, raw: raw.trim(), kind: "date", dt: dayStartMs });
    }
  }
  if (cands.length === 0) return null;

  const dueMoment = (c: (typeof cands)[number]): number =>
    c.kind === "date" ? c.dt + 24 * 60 * 60_000 : c.dt;

  const future = cands.filter((c) => dueMoment(c) >= nowMs);
  if (future.length > 0) {
    const pick = future.reduce((a, b) => (a.dt <= b.dt ? a : b));
    return { ...pick, overdue: false };
  }
  const pick = cands.reduce((a, b) => (a.dt >= b.dt ? a : b));
  return { ...pick, overdue: true };
}

/** ledger 的 status → 卡片上的 InterviewType 标签，是近似值不是台账事实。 */
const TYPE_BY_STATUS: Record<string, Interview["type"]> = {
  oa: "assessment",
  phone: "phone",
  // applied 状态下台账没有单独的「面试形式」字段，退到最中性的默认值。
  applied: "hr",
};

export interface BuildOptions {
  /** epoch ms，用于判断 pick_when 里的「过没过期」。 */
  now: number;
}

/**
 * 把符合选取条件的 ledger 行变成 Interview 列表。
 * 与 export_ics.py 一样：单条记录解析失败就跳过它，不让整批失败。
 */
export function buildLedgerInterviews(
  rows: readonly LedgerAppRow[],
  opts: BuildOptions,
): Interview[] {
  const out: Interview[] = [];
  for (const row of rows) {
    const { tz, tzOk } = tzOf(row.region);
    const pick = pickWhen(row.next_due, row.deadline, tz, opts.now);
    if (!pick) continue;

    const startUtc = new Date(pick.dt).toISOString();
    const endUtc = new Date(
      pick.dt + (pick.kind === "timed" ? 60 * 60_000 : 24 * 60 * 60_000),
    ).toISOString();

    const marks: string[] = [];
    if (!tzOk) marks.push(TZ_UNSURE_MARK);
    if (pick.overdue) marks.push(OVERDUE_MARK);

    const status = (row.status ?? "").trim();
    const rolePart = row.role?.trim() || "岗位待补";
    const position = marks.length > 0 ? `${rolePart} · ${marks.join(" · ")}` : rolePart;

    out.push({
      id: `ledger-${row.id}`,
      company: (row.company ?? "未知公司").trim() || "未知公司",
      position,
      startUtc,
      endUtc,
      sourceTimeZone: tz,
      timePrecision: pick.kind,
      sourceTimeZoneConfirmed: tzOk,
      // ledger 没有重要度概念，给中性默认值，不参与优先级判断的极端加权。
      importance: 3,
      type: TYPE_BY_STATUS[status] ?? "video",
      status: "scheduled",
      subCalendarId: LEDGER_SUB_CALENDAR_ID,
      location: null,
      externalId: `ledger-${row.id}`,
      source: "ledger",
      prep: {
        meetingUrl: null,
        resumeUrl: null,
        jdNotes: row.next_action?.trim() || null,
        checklist: [],
      },
    });
  }
  return out;
}
