import { describeWhen, kindLabelOf } from "./parseDemo";
import type { DemoResult } from "./parseDemo";
import { kindChoice } from "./userEdits";
import type { Decision, ManualEvent, ResolvedTime, UserEdits } from "./userEdits";

/**
 * 日程与日历的视图模型：把逐封邮件的解析结果折叠成「一件事一条」。
 *
 * 折叠只按引擎给的识别键（dedupKey）做，这里不自己判断两封信是不是同一件事。
 */

export interface ParsedEntry {
  sampleId: string;
  /** 邮件主题，用于「来自哪几封邮件」。 */
  subject: string;
  result: DemoResult;
}

/**
 * 一件事现在摆在哪。和 `result.destination` 的区别：destination 是**系统**的判断，
 * place 是叠加了**用户的决定**之后的最终位置。两个都留着，界面才说得清
 * 「这是系统排的」还是「这是你确认的」。
 *
 * - board：  在日程和日历上
 * - pending：等用户确认
 * - tracked：不在日程上，但算作这家公司走到过的一步（只记到投递表 / 从日程移出）
 * - ignored：哪里都不记
 */
export type Place = "board" | "pending" | "tracked" | "ignored";

export interface AgendaItem {
  key: string;
  /**
   * 跨天稳定的标识：这件事最早那封邮件的 id，或手动日程自己的 id。
   * 用户的决定按它存——`key`（去重键）里带着日期，而演示样本的日期每天在变。
   */
  id: string;
  place: Place;
  /** 从邮件解析出来的，还是用户手动加的。 */
  origin: "email" | "manual";
  /** 用户对它做过的处理。没处理过为 null。 */
  decision: Decision | null;
  /** 取这件事里最早出现的那封信的结论。 */
  result: DemoResult;
  /** 说的是这件事的所有邮件，按出现顺序。 */
  sources: readonly { sampleId: string; subject: string }[];
}

export function buildAgenda(entries: readonly ParsedEntry[]): AgendaItem[] {
  const byKey = new Map<string, { result: DemoResult; sources: { sampleId: string; subject: string }[] }>();
  for (const entry of entries) {
    const key = entry.result.dedupKey;
    if (key === null) continue; // 被忽略的邮件不是事件
    const existing = byKey.get(key);
    const source = { sampleId: entry.sampleId, subject: entry.subject };
    if (existing) existing.sources.push(source);
    else byKey.set(key, { result: entry.result, sources: [source] });
  }
  const items = [...byKey.entries()].map(
    ([key, value]): AgendaItem => ({
      key,
      id: value.sources[0]?.sampleId ?? key,
      place: placeOf(value.result),
      origin: "email",
      decision: null,
      ...value,
    }),
  );
  return sortByTime(items);
}

/**
 * 回执和结果通知没有要你去做的事，不占日程的位置——它们记在投递表里。
 * 日程上只放需要你在某个时候做点什么的事：测评、面试、补材料。
 */
function placeOf(result: DemoResult): Place {
  if (result.destination === "board") {
    return result.eventType === "application_ok" || result.eventType === "result" ? "tracked" : "board";
  }
  if (result.destination === "pending") return "pending";
  return "ignored";
}

/** 有确切时刻的按时间先后排前面，没有的保持原顺序排在后面。 */
function sortByTime(items: readonly AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => {
    const ta = a.result.when?.utc ?? null;
    const tb = b.result.when?.utc ?? null;
    if (ta !== null && tb !== null) return ta < tb ? -1 : ta > tb ? 1 : 0;
    if (ta !== null) return -1;
    if (tb !== null) return 1;
    return 0;
  });
}

/** 把用户填的时间叠到一条结论上。 */
function withTime(result: DemoResult, time: ResolvedTime, viewerTimeZone: string): DemoResult {
  if (time.timeKind === "none" || time.startUtc === null) {
    return { ...result, dueType: "unknown", when: null, dueReason: "你确认过：这件事没有具体时间" };
  }
  return {
    ...result,
    dueType: time.timeKind,
    when: describeWhen(time.startUtc, time.timeZone, viewerTimeZone),
    timeZone: time.timeZone,
    dueReason: "时间是你手动填的",
  };
}

function manualToItem(event: ManualEvent, viewerTimeZone: string): AgendaItem {
  const choice = kindChoice(event.kind);
  const base: DemoResult = {
    destination: "board",
    company: event.company,
    displayCompany: event.company,
    role: event.role.length > 0 ? event.role : null,
    eventType: choice.eventType,
    format: choice.format,
    kindLabel: choice.label,
    dueType: "unknown",
    dueReason: "",
    when: null,
    timeZone: null,
    confidence: null,
    confidenceReasons: [],
    dedupKey: null,
    extraction: null,
    links: [],
    credentials: [],
    trace: [],
  };
  return {
    key: `manual:${event.id}`,
    id: `manual:${event.id}`,
    place: "board",
    origin: "manual",
    decision: null,
    result: withTime(base, event, viewerTimeZone),
    sources: [],
  };
}

/**
 * 把用户的决定叠到解析结果上，得到最终的日程。
 *
 * 解析结果每次现场重算，决定单独存——所以引擎以后变聪明了，用户没碰过的事会跟着变好，
 * 碰过的事保持用户说的样子。
 */
export function applyEdits(
  items: readonly AgendaItem[],
  edits: UserEdits,
  viewerTimeZone: string,
): AgendaItem[] {
  const decided = items.map((item): AgendaItem => {
    const decision = edits.decisions[item.id];
    if (decision === undefined) return item;
    if (decision.action === "ignore") return { ...item, place: "ignored", decision };
    if (decision.action === "track" || decision.action === "remove") {
      return { ...item, place: "tracked", decision };
    }
    // 这是「日程上的这一条」的结论，不是那封邮件的——邮件视图和统计仍然看系统最初的判断
    let result: DemoResult = { ...item.result, destination: "board" };
    if (decision.kind !== null) {
      const choice = kindChoice(decision.kind);
      result = {
        ...result,
        eventType: choice.eventType,
        format: choice.format,
        kindLabel: kindLabelOf(choice.eventType, choice.format),
      };
    }
    if (decision.time !== null) result = withTime(result, decision.time, viewerTimeZone);
    return { ...item, place: "board", decision, result };
  });
  const manual = edits.manualEvents.map((event) => manualToItem(event, viewerTimeZone));
  return sortByTime([...decided, ...manual]);
}

/** 某个 UTC 时刻在指定时区是哪一天，`YYYY-MM-DD`。 */
export function dateKeyIn(utc: string | number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(utc));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * 能画到日历上的事：已排进日程，且时刻能换算（时区已知）。
 * 待确认的不画——日历上出现的每一格都应该是可以照着去做的。
 */
export function calendarItems(items: readonly AgendaItem[]): AgendaItem[] {
  return items.filter(
    (item) =>
      item.place === "board" &&
      item.result.when !== null &&
      item.result.when.source !== null,
  );
}

/** 按「你所在时区的日期」分组。同一场考试对北京和纽约可能不是同一天，日历按看的人算。 */
export function groupByDate(
  items: readonly AgendaItem[],
  viewerTimeZone: string,
): Map<string, AgendaItem[]> {
  const out = new Map<string, AgendaItem[]>();
  for (const item of calendarItems(items)) {
    const key = dateKeyIn(item.result.when?.utc ?? "", viewerTimeZone);
    const list = out.get(key);
    if (list) list.push(item);
    else out.set(key, [item]);
  }
  return out;
}

export interface CalendarDay {
  dateKey: string;
  day: number;
  inMonth: boolean;
}

export interface CalendarMonth {
  year: number;
  /** 1–12 */
  month: number;
  /** 周一开头，每周 7 格，首尾用相邻月份补齐。 */
  weeks: CalendarDay[][];
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * 月历网格。纯日历运算，全程用 UTC 的年月日当「日历日期」算，不涉及任何时区换算——
 * 这里的日期只是格子的编号，事件落在哪一格由 groupByDate 决定。
 */
export function buildMonth(year: number, month: number): CalendarMonth {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay：周日 0 … 周六 6 → 换成周一 0 … 周日 6
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;

  const days: CalendarDay[] = [];
  for (let i = 0; i < cells; i += 1) {
    const date = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    days.push({
      dateKey: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1,
    });
  }
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return { year, month, weeks };
}

/** 往前或往后挪几个月，处理跨年。 */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
