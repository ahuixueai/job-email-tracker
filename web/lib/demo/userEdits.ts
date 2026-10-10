import { wallClockToUtc } from "../tracker-core/index";
import type { EventFormat, EventType } from "../tracker-core/index";

/**
 * 用户在看板上做的手动操作：确认待确认的事、把事移出日程、手动加日程、改投递状态。
 *
 * 这一层是纯数据 + 纯函数，不碰浏览器存储——存取在 Workspace 里做，
 * 这样规则可以直接测，也方便以后把存储从浏览器本地换成后端。
 *
 * 立场和引擎一致：**用户说的话优先于系统判断，而且系统不许悄悄改回去。**
 * 所以这里存的是「用户的决定」，不是「改过之后的结果」——解析结果每次现场重算，
 * 再把决定叠上去。
 */

/** 表单里「这是什么事」的选项。每一项对应引擎的一组（事件类型, 形式）。 */
export const KIND_CHOICES = [
  { id: "written_test", label: "笔试", eventType: "assessment", format: "written_test" },
  { id: "online_assessment", label: "在线测评", eventType: "assessment", format: "online_assessment" },
  { id: "ai_interview", label: "AI 面试", eventType: "interview", format: "ai_interview" },
  { id: "phone_interview", label: "电话面试", eventType: "interview", format: "phone_interview" },
  { id: "video_interview", label: "视频面试", eventType: "interview", format: "video_interview" },
  { id: "onsite_interview", label: "线下面试", eventType: "interview", format: "onsite_interview" },
  { id: "interview", label: "面试（形式未定）", eventType: "interview", format: "unspecified" },
  { id: "update", label: "补材料", eventType: "update", format: "not_applicable" },
  { id: "other", label: "其他", eventType: "other", format: "not_applicable" },
] as const satisfies readonly {
  id: string;
  label: string;
  eventType: EventType;
  format: EventFormat;
}[];

export type KindId = (typeof KIND_CHOICES)[number]["id"];

export function kindChoice(id: KindId): (typeof KIND_CHOICES)[number] {
  return KIND_CHOICES.find((k) => k.id === id) ?? KIND_CHOICES[KIND_CHOICES.length - 1]!;
}

/** 从引擎的（事件类型, 形式）反查表单选项。对不上的归到「其他」。 */
export function kindIdOf(eventType: EventType | null, format: EventFormat | null): KindId {
  const exact = KIND_CHOICES.find((k) => k.eventType === eventType && k.format === format);
  if (exact) return exact.id;
  if (eventType === "interview") return "interview";
  if (eventType === "assessment") return "online_assessment";
  if (eventType === "update") return "update";
  return "other";
}

export type TimeKind = "fixed_start" | "deadline" | "none";

/** 一件事的时间，已经换算成绝对时刻。 */
export interface ResolvedTime {
  timeKind: TimeKind;
  /** timeKind 为 none 时是 null。 */
  startUtc: string | null;
  /** 用户填写时所在的时区。时刻是按它解释的，必须记下来，不能事后再猜。 */
  timeZone: string;
}

/** 手动添加的日程。 */
export interface ManualEvent extends ResolvedTime {
  id: string;
  company: string;
  role: string;
  kind: KindId;
  createdAtMs: number;
}

/**
 * 对一件解析出来的事的处理。
 * - confirm：放进日程。kind / time 为 null 表示沿用系统的判断，没改。
 * - track：  只记到投递表，不上日程。
 * - remove： 从日程里移出（它仍然算这家公司走到过的一步）。
 * - ignore： 与求职无关，哪里都不记。
 */
export type Decision =
  | { action: "confirm"; kind: KindId | null; time: ResolvedTime | null }
  | { action: "track" }
  | { action: "remove" }
  | { action: "ignore" };

/** 投递表里能选的状态。 */
export const STAGES = ["applied", "materials", "assessment", "interview", "offer", "rejected"] as const;
export type Stage = (typeof STAGES)[number];

export const ROUNDS = ["一面", "二面", "三面", "终面"] as const;
export type Round = (typeof ROUNDS)[number];

/** 用户手动改的投递状态。 */
export interface ApplicationPatch {
  stage: Stage;
  round: Round | null;
}

/** 手动添加的投递记录（系统没从邮件里看到的那些）。 */
export interface ManualApplication {
  id: string;
  company: string;
  role: string;
  stage: Stage;
  round: Round | null;
  /** 投递日期 `YYYY-MM-DD`，没填为空串。 */
  appliedOn: string;
  createdAtMs: number;
}

export interface UserEdits {
  version: 1;
  /** 键是这件事的稳定标识（它最早那封邮件的 id）。 */
  decisions: Readonly<Record<string, Decision>>;
  manualEvents: readonly ManualEvent[];
  /** 键是投递表行的 key。 */
  applicationPatches: Readonly<Record<string, ApplicationPatch>>;
  manualApplications: readonly ManualApplication[];
}

export const EMPTY_EDITS: UserEdits = {
  version: 1,
  decisions: {},
  manualEvents: [],
  applicationPatches: {},
  manualApplications: [],
};

export const EDITS_STORAGE_KEY = "jcc.demo.edits.v1";

export function hasEdits(edits: UserEdits): boolean {
  return (
    Object.keys(edits.decisions).length > 0 ||
    edits.manualEvents.length > 0 ||
    Object.keys(edits.applicationPatches).length > 0 ||
    edits.manualApplications.length > 0
  );
}

// ---------- 修改（全部返回新对象） ----------

export function decide(edits: UserEdits, key: string, decision: Decision): UserEdits {
  return { ...edits, decisions: { ...edits.decisions, [key]: decision } };
}

/** 撤销对某件事的处理，让它回到系统原本放的位置。 */
export function undecide(edits: UserEdits, key: string): UserEdits {
  const rest = { ...edits.decisions };
  delete rest[key];
  return { ...edits, decisions: rest };
}

export function addManualEvent(edits: UserEdits, event: ManualEvent): UserEdits {
  return { ...edits, manualEvents: [...edits.manualEvents, event] };
}

export function removeManualEvent(edits: UserEdits, id: string): UserEdits {
  return { ...edits, manualEvents: edits.manualEvents.filter((e) => e.id !== id) };
}

export function patchApplication(edits: UserEdits, key: string, patch: ApplicationPatch): UserEdits {
  return { ...edits, applicationPatches: { ...edits.applicationPatches, [key]: patch } };
}

export function unpatchApplication(edits: UserEdits, key: string): UserEdits {
  const rest = { ...edits.applicationPatches };
  delete rest[key];
  return { ...edits, applicationPatches: rest };
}

export function addManualApplication(edits: UserEdits, application: ManualApplication): UserEdits {
  return { ...edits, manualApplications: [...edits.manualApplications, application] };
}

export function removeManualApplication(edits: UserEdits, id: string): UserEdits {
  const patches = { ...edits.applicationPatches };
  delete patches[`manual:${id}`];
  return {
    ...edits,
    applicationPatches: patches,
    manualApplications: edits.manualApplications.filter((a) => a.id !== id),
  };
}

// ---------- 时间换算 ----------

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * 表单里的「本地日期时间」（`<input type="datetime-local">` 的值）→ 绝对时刻。
 * 按传入的时区解释——那是用户所在的时区，由调用方明确给出，这里不猜。
 * 填的不是合法时间时返回 null。
 */
export function localInputToUtc(local: string, timeZone: string): string | null {
  if (!LOCAL_INPUT.test(local)) return null;
  try {
    const utc = wallClockToUtc(local.replace("T", " "), timeZone);
    return Number.isNaN(Date.parse(utc)) ? null : utc;
  } catch {
    return null;
  }
}

/** 绝对时刻 → 表单里的「本地日期时间」，用于预填。 */
export function utcToLocalInput(utc: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utc));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** 把表单里的时间部分收成 ResolvedTime。时间没填对时返回 null（timeKind 为 none 时不需要时间）。 */
export function resolveTime(timeKind: TimeKind, local: string, timeZone: string): ResolvedTime | null {
  if (timeKind === "none") return { timeKind, startUtc: null, timeZone };
  const startUtc = localInputToUtc(local, timeZone);
  return startUtc === null ? null : { timeKind, startUtc, timeZone };
}

// ---------- 读取（浏览器存储里的东西不可信，逐项校验） ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isKindId = (v: unknown): v is KindId => KIND_CHOICES.some((k) => k.id === v);
const isStage = (v: unknown): v is Stage => (STAGES as readonly unknown[]).includes(v);
const isRound = (v: unknown): v is Round => (ROUNDS as readonly unknown[]).includes(v);
const isTimeKind = (v: unknown): v is TimeKind => v === "fixed_start" || v === "deadline" || v === "none";

function parseTime(value: unknown): ResolvedTime | null {
  if (!isRecord(value) || !isTimeKind(value.timeKind) || typeof value.timeZone !== "string") return null;
  if (value.timeKind === "none") return { timeKind: "none", startUtc: null, timeZone: value.timeZone };
  if (typeof value.startUtc !== "string" || Number.isNaN(Date.parse(value.startUtc))) return null;
  return { timeKind: value.timeKind, startUtc: value.startUtc, timeZone: value.timeZone };
}

function parseDecision(value: unknown): Decision | null {
  if (!isRecord(value)) return null;
  if (value.action === "track" || value.action === "remove" || value.action === "ignore") {
    return { action: value.action };
  }
  if (value.action !== "confirm") return null;
  return {
    action: "confirm",
    kind: isKindId(value.kind) ? value.kind : null,
    time: value.time === null || value.time === undefined ? null : parseTime(value.time),
  };
}

/**
 * 把存储里读出来的东西收敛成合法的 UserEdits。
 * 任何一条读不懂就丢掉那一条，不因为一条坏记录让整个看板打不开。
 */
export function parseEdits(value: unknown): UserEdits {
  if (!isRecord(value) || value.version !== 1) return EMPTY_EDITS;

  const decisions: Record<string, Decision> = {};
  if (isRecord(value.decisions)) {
    for (const [key, raw] of Object.entries(value.decisions)) {
      const decision = parseDecision(raw);
      if (decision) decisions[key] = decision;
    }
  }

  const manualEvents: ManualEvent[] = [];
  if (Array.isArray(value.manualEvents)) {
    for (const raw of value.manualEvents as unknown[]) {
      const time = parseTime(raw);
      if (!isRecord(raw) || time === null) continue;
      if (typeof raw.id !== "string" || typeof raw.company !== "string" || !isKindId(raw.kind)) continue;
      manualEvents.push({
        ...time,
        id: raw.id,
        company: raw.company,
        role: typeof raw.role === "string" ? raw.role : "",
        kind: raw.kind,
        createdAtMs: typeof raw.createdAtMs === "number" ? raw.createdAtMs : 0,
      });
    }
  }

  const applicationPatches: Record<string, ApplicationPatch> = {};
  if (isRecord(value.applicationPatches)) {
    for (const [key, raw] of Object.entries(value.applicationPatches)) {
      if (isRecord(raw) && isStage(raw.stage)) {
        applicationPatches[key] = { stage: raw.stage, round: isRound(raw.round) ? raw.round : null };
      }
    }
  }

  const manualApplications: ManualApplication[] = [];
  if (Array.isArray(value.manualApplications)) {
    for (const raw of value.manualApplications as unknown[]) {
      if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.company !== "string") continue;
      if (!isStage(raw.stage)) continue;
      manualApplications.push({
        id: raw.id,
        company: raw.company,
        role: typeof raw.role === "string" ? raw.role : "",
        stage: raw.stage,
        round: isRound(raw.round) ? raw.round : null,
        appliedOn: typeof raw.appliedOn === "string" ? raw.appliedOn : "",
        createdAtMs: typeof raw.createdAtMs === "number" ? raw.createdAtMs : 0,
      });
    }
  }

  return { version: 1, decisions, manualEvents, applicationPatches, manualApplications };
}
