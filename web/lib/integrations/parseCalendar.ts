import type { Importance, InterviewType } from "@/types";
import { normalizeTimeZone } from "@/lib/time";
import { safeExternalUrl } from "@/lib/validation";

/** Google Calendar events.list 返回里我们用得到的那部分。 */
export interface GoogleEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  status?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] };
  organizer?: { email?: string; displayName?: string };
}

/** 解析结果：还没进 store，先给用户过目。 */
export interface EventCandidate {
  externalId: string;
  company: string;
  position: string;
  startUtc: string;
  endUtc: string;
  sourceTimeZone: string;
  type: InterviewType;
  timePrecision: "timed";
  sourceTimeZoneConfirmed: true;
  importance: Importance;
  meetingUrl: string | null;
  location: string | null;
  notes: string | null;
  /** 命中了哪些关键词，用来向用户解释「为什么认为这是面试」。 */
  matched: string[];
}

const INTERVIEW_HINTS = [
  "面试", "笔试", "初面", "复面", "终面", "一面", "二面", "三面", "宣讲", "OA",
  "interview", "screen", "onsite", "technical", "assessment", "recruiter", "hiring",
];

const ASSESSMENT_HINTS = ["笔试", "OA", "assessment", "coding test", "online test"];
const PHONE_HINTS = ["电话", "phone call", "phone screen"];
const HR_HINTS = ["HR", "recruiter", "人力", "初面"];

/**
 * 会议链接可能藏在四个地方，按可靠度依次找。
 *
 * 前两处是事件创建者能填的自由文本——任何人给你发一封日历邀请就能写进来，
 * 而这个值最终会进 <a href>。一律过协议白名单，不合格当作没有。
 */
function findMeetingUrl(event: GoogleEvent): string | null {
  const hangout = safeExternalUrl(event.hangoutLink);
  if (hangout) return hangout;
  const entry = event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video" && safeExternalUrl(e.uri),
  );
  if (entry?.uri) return safeExternalUrl(entry.uri);
  const haystack = `${event.location ?? ""} ${event.description ?? ""}`;
  const match = haystack.match(
    /https?:\/\/[^\s<>"]*(zoom\.us|meeting\.tencent\.com|teams\.microsoft|meet\.google|webex|feishu|larksuite)[^\s<>"]*/i,
  );
  return match ? match[0] : null;
}

function classify(text: string): InterviewType {
  const lower = text.toLowerCase();
  const has = (list: string[]) =>
    list.some((k) => lower.includes(k.toLowerCase()));
  if (has(ASSESSMENT_HINTS)) return "assessment";
  if (has(PHONE_HINTS)) return "phone";
  if (has(HR_HINTS)) return "hr";
  return "video";
}

/**
 * 从标题里拆公司和岗位。
 *
 * 这是启发式，不可能全对——所以解析结果一律先给用户过目再入库，
 * 而不是直接写进列表。常见格式：
 *   "Interview: Data Analyst @ Stripe" / "Stripe - 数据分析三面" / "字节跳动 三面"
 */
export function splitTitle(
  summary: string,
  organizerDomain: string | null,
): { company: string; position: string } {
  const cleaned = summary.replace(/^\s*(interview|面试)\s*[:：-]\s*/i, "").trim();

  const at = cleaned.match(/^(.*?)\s*[@｜|]\s*(.+)$/);
  if (at) return { company: at[2].trim(), position: at[1].trim() };

  const dash = cleaned.match(/^(.+?)\s*[-–—·]\s*(.+)$/);
  if (dash) return { company: dash[1].trim(), position: dash[2].trim() };

  // 拆不出来就拿发起人域名当公司，标题整体当岗位，总比留空强
  return {
    company: organizerDomain ?? cleaned.split(/\s+/)[0] ?? "未知公司",
    position: cleaned || "面试",
  };
}

function domainOf(email: string | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  const domain = email.split("@")[1].toLowerCase();
  const generic = ["gmail.com", "googlemail.com", "outlook.com", "qq.com", "163.com"];
  if (generic.includes(domain)) return null;
  return domain.split(".")[0];
}

/**
 * 事件 → 候选。返回 null 表示「看起来不是面试」。
 * 整天事件（只有 date 没有 dateTime）直接跳过：没有具体时刻，
 * 塞进以时间点为核心的列表里没有意义。
 */
export function eventToCandidate(
  event: GoogleEvent,
  fallbackTimeZone: string,
): EventCandidate | null {
  if (event.status === "cancelled") return null;
  const startIso = event.start?.dateTime;
  const endIso = event.end?.dateTime;
  if (!startIso || !endIso) return null;

  const haystack = `${event.summary ?? ""} ${event.description ?? ""}`;
  const matched = INTERVIEW_HINTS.filter((k) =>
    haystack.toLowerCase().includes(k.toLowerCase()),
  );
  if (matched.length === 0) return null;

  const organizerDomain = domainOf(event.organizer?.email);
  const { company, position } = splitTitle(event.summary ?? "面试", organizerDomain);

  return {
    externalId: `gcal:${event.id ?? startIso}`,
    company,
    position,
    startUtc: new Date(startIso).toISOString(),
    endUtc: new Date(endIso).toISOString(),
    // Google 在事件上带了 IANA 时区，正好对上我们的数据模型。
    // 但两个来源都要过 normalizeTimeZone：fallbackTimeZone 来自 ?tz= 查询参数，
    // 脏值写进去以后每次渲染这张卡的 Intl.DateTimeFormat 都会抛 RangeError。
    sourceTimeZone:
      normalizeTimeZone(event.start?.timeZone) ??
      normalizeTimeZone(fallbackTimeZone) ??
      "UTC",
    // 整天事件已经在上面 return null 了，能走到这里的都带具体 dateTime；
    // 时区要么来自 Google 事件本身，要么退到查看者当前时区，两者都算确认过。
    timePrecision: "timed",
    sourceTimeZoneConfirmed: true,
    type: classify(haystack),
    importance: 3,
    meetingUrl: findMeetingUrl(event),
    location: event.location ?? null,
    notes: event.description?.slice(0, 500) ?? null,
    matched,
  };
}

export function parseEvents(
  events: readonly GoogleEvent[],
  fallbackTimeZone: string,
): EventCandidate[] {
  return events
    .map((e) => eventToCandidate(e, fallbackTimeZone))
    .filter((c): c is EventCandidate => c !== null);
}
