import type { Importance, Interview, InterviewType, InterviewStatus, SubCalendar } from "@/types";
import { normalizeTimeZone } from "@/lib/time";
import { safeExternalUrl } from "@/lib/validation";

/**
 * 导出/导入是 localStorage 唯一的兜底。
 *
 * localStorage 会被清浏览器数据、换设备、隐私模式、甚至存储配额清理干掉，
 * 而这里存的是你手填的面试安排——丢了没有第二份。
 */

export const BACKUP_FORMAT = "job-command-center/backup";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  interviews: Interview[];
  subCalendars: SubCalendar[];
  order: string[];
  manualOrder: boolean;
}

export interface BackupPayload {
  interviews: Interview[];
  subCalendars: SubCalendar[];
  order: string[];
  manualOrder: boolean;
}

export function buildBackup(payload: BackupPayload): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ...payload,
  };
}

export interface ParseResult {
  ok: boolean;
  /** 校验通过、可以导入的部分。 */
  payload?: BackupPayload;
  /** 整份文件级别的错误，有这个就完全不能导。 */
  error?: string;
  /** 被跳过的单条记录及原因，导入前展示给用户。 */
  skipped: string[];
}

const TYPES: InterviewType[] = ["video", "onsite", "phone", "assessment", "hr"];
const STATUSES: InterviewStatus[] = ["scheduled", "completed", "offer", "rejected"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * 链接会进 <a href>。协议不在白名单里就清成 null 并留痕，
 * 而不是把整条记录判死——一个坏链接不该让你丢掉整场面试的时间和备注。
 */
function takeUrl(
  raw: unknown,
  label: string,
  company: string,
  skipped: string[],
): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const safe = safeExternalUrl(raw);
  if (!safe) {
    skipped.push(`${company}：${label}不是 http/https 地址，已清空`);
    return null;
  }
  return safe;
}

function parseInterview(
  raw: unknown,
  index: number,
  skipped: string[],
): Interview | string {
  if (!isRecord(raw)) return `第 ${index + 1} 条不是对象`;
  const id = str(raw.id);
  const company = str(raw.company);
  const position = str(raw.position);
  const startUtc = str(raw.startUtc);
  const endUtc = str(raw.endUtc);
  const zone = normalizeTimeZone(str(raw.sourceTimeZone));

  if (!id) return `第 ${index + 1} 条缺 id`;
  if (!company) return `${id}：缺公司名`;
  if (!startUtc || Number.isNaN(Date.parse(startUtc))) return `${company}：开始时间不是合法时间`;
  if (!endUtc || Number.isNaN(Date.parse(endUtc))) return `${company}：结束时间不是合法时间`;
  if (!zone) return `${company}：时区 ${String(raw.sourceTimeZone)} 不是合法的 IANA 时区`;

  const importance = Number(raw.importance);
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
    return `${company}：重要度必须是 1 到 5`;
  }
  const type = str(raw.type);
  if (!type || !TYPES.includes(type as InterviewType)) return `${company}：类型 ${type} 未知`;
  const status = str(raw.status);
  if (!status || !STATUSES.includes(status as InterviewStatus)) {
    return `${company}：状态 ${status} 未知`;
  }
  const subCalendarId = str(raw.subCalendarId);
  if (!subCalendarId) return `${company}：缺子日历 id`;

  // 两个字段是这一轮才加的（区分「知道具体钟点」与「只知道日期」）。
  // 老备份文件没有这两个字段——那些数据在这个概念出现之前一律是「有具体钟点、
  // 时区是手选或来自 Google 日历」，默认成 timed/true 才是对旧数据的准确还原，
  // 不是编造：真值本来就是这样，只是当时没地方记。
  const timePrecision: Interview["timePrecision"] =
    raw.timePrecision === "date" ? "date" : "timed";
  const sourceTimeZoneConfirmed = raw.sourceTimeZoneConfirmed !== false;

  const prep = isRecord(raw.prep) ? raw.prep : {};
  return {
    id,
    company,
    position: position ?? "",
    // 一律重新规范化成 UTC ISO，别把导入文件里的写法直接信进来
    startUtc: new Date(startUtc).toISOString(),
    endUtc: new Date(endUtc).toISOString(),
    sourceTimeZone: zone,
    timePrecision,
    sourceTimeZoneConfirmed,
    importance: importance as Importance,
    type: type as InterviewType,
    status: status as InterviewStatus,
    subCalendarId,
    location: str(raw.location),
    externalId: str(raw.externalId),
    source: str(raw.source) === "google-calendar" ? "google-calendar" : "manual",
    prep: {
      meetingUrl: takeUrl(prep.meetingUrl, "会议链接", company, skipped),
      resumeUrl: takeUrl(prep.resumeUrl, "简历链接", company, skipped),
      jdNotes: str(prep.jdNotes),
      checklist: Array.isArray(prep.checklist)
        ? prep.checklist.filter((c): c is string => typeof c === "string")
        : [],
    },
  };
}

function parseCalendar(raw: unknown, index: number): SubCalendar | string {
  if (!isRecord(raw)) return `子日历第 ${index + 1} 条不是对象`;
  const id = str(raw.id);
  const name = str(raw.name);
  const color = str(raw.color);
  if (!id) return `子日历第 ${index + 1} 条缺 id`;
  if (!name) return `子日历 ${id} 缺名字`;
  // 颜色会被直接写进 style，只接受十六进制，杜绝注入
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `子日历「${name}」的颜色不是 #RRGGBB`;
  }
  return { id, name, color, description: str(raw.description) };
}

/** 解析并校验一份备份文件。逐条校验，坏的跳过并说明原因，不是一坏全废。 */
export function parseBackup(input: unknown): ParseResult {
  const skipped: string[] = [];
  if (!isRecord(input)) return { ok: false, error: "文件内容不是 JSON 对象", skipped };
  if (input.format !== BACKUP_FORMAT) {
    return { ok: false, error: "这不像本应用导出的备份文件", skipped };
  }
  if (Number(input.version) > BACKUP_VERSION) {
    return {
      ok: false,
      error: `备份版本 ${String(input.version)} 比当前应用还新，先升级应用再导入`,
      skipped,
    };
  }
  if (!Array.isArray(input.interviews) || !Array.isArray(input.subCalendars)) {
    return { ok: false, error: "缺少 interviews 或 subCalendars 字段", skipped };
  }

  const subCalendars: SubCalendar[] = [];
  for (const [i, raw] of input.subCalendars.entries()) {
    const parsed = parseCalendar(raw, i);
    if (typeof parsed === "string") skipped.push(parsed);
    else subCalendars.push(parsed);
  }

  const calendarIds = new Set(subCalendars.map((c) => c.id));
  const interviews: Interview[] = [];
  for (const [i, raw] of input.interviews.entries()) {
    const parsed = parseInterview(raw, i, skipped);
    if (typeof parsed === "string") {
      skipped.push(parsed);
      continue;
    }
    // 指向不存在的子日历会让卡片显示「未归类」，落到第一个日历更合理
    if (!calendarIds.has(parsed.subCalendarId) && subCalendars.length > 0) {
      parsed.subCalendarId = subCalendars[0].id;
      skipped.push(`${parsed.company}：原子日历不存在，已归入「${subCalendars[0].name}」`);
    }
    interviews.push(parsed);
  }

  const ids = new Set(interviews.map((i) => i.id));
  const order = Array.isArray(input.order)
    ? input.order.filter((id): id is string => typeof id === "string" && ids.has(id))
    : [];
  // 备份里漏掉的 id 补到末尾，保证每张卡都有位置
  for (const id of ids) if (!order.includes(id)) order.push(id);

  return {
    ok: true,
    skipped,
    payload: {
      interviews,
      subCalendars,
      order,
      manualOrder: input.manualOrder === true,
    },
  };
}

/** 合并：同 id 以导入的为准，其余保留。 */
export function mergePayload(
  current: BackupPayload,
  incoming: BackupPayload,
): BackupPayload {
  const calendars = new Map(current.subCalendars.map((c) => [c.id, c]));
  for (const cal of incoming.subCalendars) calendars.set(cal.id, cal);

  const interviews = new Map(current.interviews.map((i) => [i.id, i]));
  for (const item of incoming.interviews) interviews.set(item.id, item);

  const order = [...current.order];
  for (const id of incoming.order) if (!order.includes(id)) order.push(id);

  return {
    interviews: [...interviews.values()],
    subCalendars: [...calendars.values()],
    order: order.filter((id) => interviews.has(id)),
    manualOrder: current.manualOrder || incoming.manualOrder,
  };
}
