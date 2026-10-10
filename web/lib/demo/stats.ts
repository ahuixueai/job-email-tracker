import type { AgendaItem } from "./agenda";
import { dateKeyIn } from "./agenda";
import { STAGE_LABEL } from "./applications";
import type { ApplicationRow, Reach } from "./applications";
import type { Destination } from "./parseDemo";
import { STAGES } from "./userEdits";
import type { Stage } from "./userEdits";

/**
 * 「统计」视图的数字。全部从投递表、日程和邮件列表算出来，这里不存任何东西。
 * 每个函数只回答一个问题，图表组件只管画。
 */

const DAY = 86_400_000;

export interface Kpis {
  /** 投了多少家。 */
  applications: number;
  /** 还在流程里的（没收到拒信、也还没拿到 Offer）。 */
  active: number;
  /** 未来 7 天内日程上有几件事。 */
  dueThisWeek: number;
  /** 等用户确认的事。 */
  pending: number;
}

export function kpis(rows: readonly ApplicationRow[], agenda: readonly AgendaItem[], nowMs: number): Kpis {
  const inWeek = agenda.filter((item) => {
    if (item.place !== "board" || item.result.when === null) return false;
    const at = Date.parse(item.result.when.utc);
    return at > nowMs && at <= nowMs + 7 * DAY;
  });
  return {
    applications: rows.length,
    active: rows.filter((r) => r.stage !== "rejected" && r.stage !== "offer").length,
    dueThisWeek: inWeek.length,
    pending: agenda.filter((item) => item.place === "pending").length,
  };
}

export interface FunnelStep {
  reach: Reach;
  label: string;
  count: number;
  /** 占投递总数的比例，0–1。总数为 0 时是 0。 */
  share: number;
  /** 相对上一步的转化率，0–1。第一步为 null。 */
  fromPrevious: number | null;
}

const FUNNEL: readonly { reach: Reach; label: string }[] = [
  { reach: "applied", label: "投递" },
  { reach: "assessment", label: "进入测评" },
  { reach: "interview", label: "进入面试" },
  { reach: "offer", label: "拿到 Offer" },
];
const REACH_ORDER: readonly Reach[] = ["applied", "assessment", "interview", "offer"];

/**
 * 求职漏斗：每一步是「至少走到这一步」的公司数，所以后一步永远不超过前一步。
 * 有的公司不设测评、直接面试——它也算「走过了测评这一步」，否则漏斗会出现后面比前面宽的怪形状。
 */
export function funnel(rows: readonly ApplicationRow[]): FunnelStep[] {
  const total = rows.length;
  let previous: number | null = null;
  return FUNNEL.map(({ reach, label }) => {
    const at = REACH_ORDER.indexOf(reach);
    const count = rows.filter((r) => REACH_ORDER.indexOf(r.reach) >= at).length;
    const step: FunnelStep = {
      reach,
      label,
      count,
      share: total === 0 ? 0 : count / total,
      fromPrevious: previous === null ? null : previous === 0 ? 0 : count / previous,
    };
    previous = count;
    return step;
  });
}

export interface StageCount {
  stage: Stage;
  label: string;
  count: number;
}

/** 各家公司**现在**停在哪一步。和漏斗不同：这里每家只算一次，加起来等于总数。 */
export function stageDistribution(rows: readonly ApplicationRow[]): StageCount[] {
  return STAGES.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    count: rows.filter((r) => r.stage === stage).length,
  }));
}

export interface DayLoad {
  dateKey: string;
  /** 「10/14」 */
  label: string;
  /** 「周三」 */
  weekday: string;
  fixed: number;
  deadline: number;
}

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/**
 * 接下来 N 天，每天有几件要准点到的事、几件要在当天截止前完成的事。
 * 日期按看的人所在时区算，和日历一致。
 */
export function upcomingLoad(
  agenda: readonly AgendaItem[],
  nowMs: number,
  viewerTimeZone: string,
  days = 14,
): DayLoad[] {
  const out: DayLoad[] = [];
  const byKey = new Map<string, DayLoad>();
  const todayKey = dateKeyIn(nowMs, viewerTimeZone);
  const start = Date.UTC(Number(todayKey.slice(0, 4)), Number(todayKey.slice(5, 7)) - 1, Number(todayKey.slice(8, 10)));
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start + i * DAY);
    const dateKey = date.toISOString().slice(0, 10);
    const load: DayLoad = {
      dateKey,
      label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
      weekday: WEEKDAY[date.getUTCDay()] ?? "",
      fixed: 0,
      deadline: 0,
    };
    out.push(load);
    byKey.set(dateKey, load);
  }
  for (const item of agenda) {
    if (item.place !== "board" || item.result.when === null) continue;
    if (Date.parse(item.result.when.utc) <= nowMs) continue;
    const load = byKey.get(dateKeyIn(item.result.when.utc, viewerTimeZone));
    if (!load) continue;
    if (item.result.dueType === "fixed_start") load.fixed += 1;
    else if (item.result.dueType === "deadline") load.deadline += 1;
  }
  return out;
}

export interface WeekCount {
  /** 这一周周一的日期 `YYYY-MM-DD`（看的人所在时区）。 */
  weekStart: string;
  /** 「9/28 那周」 */
  label: string;
  count: number;
}

/** 某个日历日所在那一周的周一。纯日历运算。 */
function mondayOf(dateKey: string): string {
  const date = new Date(Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, Number(dateKey.slice(8, 10))));
  const back = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - back * DAY).toISOString().slice(0, 10);
}

/** 最近 N 周，每周收到多少封求职流程邮件（被忽略的验证码、广告不算）。 */
export function weeklyEmails(
  emails: readonly { receivedAtUtc: string; destination: Destination }[],
  nowMs: number,
  viewerTimeZone: string,
  weeks = 5,
): WeekCount[] {
  const thisMonday = mondayOf(dateKeyIn(nowMs, viewerTimeZone));
  const base = Date.parse(`${thisMonday}T00:00:00.000Z`);
  const out: WeekCount[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const monday = new Date(base - i * 7 * DAY);
    out.push({
      weekStart: monday.toISOString().slice(0, 10),
      label: i === 0 ? "本周" : `${monday.getUTCMonth() + 1}/${monday.getUTCDate()} 那周`,
      count: 0,
    });
  }
  for (const email of emails) {
    if (email.destination === "dropped" || email.destination === "noise") continue;
    const monday = mondayOf(dateKeyIn(email.receivedAtUtc, viewerTimeZone));
    const week = out.find((w) => w.weekStart === monday);
    if (week) week.count += 1;
  }
  return out;
}

export interface HandlingCount {
  id: "auto" | "pending" | "ignored";
  label: string;
  count: number;
}

/**
 * 系统自己处理了多少。按**系统最初的判断**算（destination），不是按用户处理之后的位置——
 * 这张图回答的是「系统替我省了多少事」，用户点过确认不该让它看起来更好。
 */
export function handling(emails: readonly { destination: Destination }[]): HandlingCount[] {
  const count = (test: (d: Destination) => boolean): number => emails.filter((e) => test(e.destination)).length;
  return [
    { id: "auto", label: "自动整理好", count: count((d) => d === "board") },
    { id: "pending", label: "留给你确认", count: count((d) => d === "pending") },
    { id: "ignored", label: "判为无关", count: count((d) => d === "noise" || d === "dropped") },
  ];
}
