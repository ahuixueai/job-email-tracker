"use client";

import type { Importance, Interview, InterviewType } from "@/types";
import {
  getLocalTimeZone,
  toZonedTime,
  utcFromZonedWallClock,
  zoneOffsetMinutes,
} from "@/lib/time";
import { safeExternalUrl } from "@/lib/validation";
import type { NewInterview } from "@/store/useInterviewStore";

/** 表单里的字段都是字符串，提交时再换算成 UTC。 */
export interface InterviewFormValues {
  company: string;
  position: string;
  /** 面试当地的日期 YYYY-MM-DD */
  date: string;
  /** 面试当地的时间 HH:mm。timePrecision 为 "date" 时这个值不使用。 */
  time: string;
  durationMinutes: string;
  /** "date"：只知道日期，还没排出具体钟点——比如「HR 说这周会约」。 */
  timePrecision: "timed" | "date";
  sourceTimeZone: string;
  type: InterviewType;
  importance: Importance;
  subCalendarId: string;
  meetingUrl: string;
  resumeUrl: string;
  jdNotes: string;
  location: string;
}

export const TYPE_OPTIONS: { value: InterviewType; label: string }[] = [
  { value: "video", label: "视频面试" },
  { value: "onsite", label: "现场面试" },
  { value: "phone", label: "电话面试" },
  { value: "assessment", label: "在线笔试" },
  { value: "hr", label: "HR 初面" },
];

/**
 * 可选时区列表。优先用 Intl.supportedValuesOf 拿完整 IANA 列表，
 * 不硬编码；老浏览器没有这个 API 时回落到一份常用清单。
 */
export function timeZoneOptions(): string[] {
  const local = getLocalTimeZone();
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : FALLBACK_ZONES;
  const list = [...supported];
  // 把本机时区顶到最前，最常用
  return [local, ...list.filter((z) => z !== local)];
}

const FALLBACK_ZONES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Tokyo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
  "UTC",
];

/** 新建时的默认值：默认落在本机时区的明天上午 10 点。 */
export function emptyForm(subCalendarId: string): InterviewFormValues {
  const zone = getLocalTimeZone();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const parts = toZonedTime(tomorrow.toISOString(), zone);
  return {
    company: "",
    position: "",
    date: isoDateInZone(tomorrow, zone),
    time: "10:00",
    durationMinutes: "60",
    timePrecision: "timed",
    sourceTimeZone: zone,
    type: "video",
    importance: 3,
    subCalendarId,
    meetingUrl: "",
    resumeUrl: "",
    jdNotes: "",
    location: parts.zone === zone ? "" : "",
  };
}

/** 某时刻在某时区的日历日，YYYY-MM-DD。 */
function isoDateInZone(date: Date, timeZone: string): string {
  const shifted = new Date(
    date.getTime() + zoneOffsetMinutes(date, timeZone) * 60_000,
  );
  return shifted.toISOString().slice(0, 10);
}

/** 把已有面试还原成表单值，供编辑使用。 */
export function formFromInterview(interview: Interview): InterviewFormValues {
  const zone = interview.sourceTimeZone;
  const start = new Date(interview.startUtc);
  const local = toZonedTime(interview.startUtc, zone);
  return {
    company: interview.company,
    position: interview.position,
    date: isoDateInZone(start, zone),
    time: local.time,
    durationMinutes: String(
      Math.round(
        (Date.parse(interview.endUtc) - Date.parse(interview.startUtc)) / 60_000,
      ),
    ),
    timePrecision: interview.timePrecision,
    sourceTimeZone: zone,
    type: interview.type,
    importance: interview.importance,
    subCalendarId: interview.subCalendarId,
    meetingUrl: interview.prep.meetingUrl ?? "",
    resumeUrl: interview.prep.resumeUrl ?? "",
    jdNotes: interview.prep.jdNotes ?? "",
    location: interview.location ?? "",
  };
}

export interface FormErrors {
  company?: string;
  position?: string;
  date?: string;
  time?: string;
  durationMinutes?: string;
  meetingUrl?: string;
  resumeUrl?: string;
}

export function validateForm(values: InterviewFormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.company.trim()) errors.company = "填一下公司名";
  if (!values.position.trim()) errors.position = "填一下岗位";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) errors.date = "选一个日期";
  // 「只知道日期」时不要求具体钟点和时长——本来就不知道，不能逼用户编一个。
  if (values.timePrecision === "timed") {
    if (!/^\d{2}:\d{2}$/.test(values.time)) errors.time = "选一个时间";
    const minutes = Number(values.durationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
      errors.durationMinutes = "时长填 1 到 600 分钟";
    }
  }
  // 链接留空可以，填了就必须是能点开的完整地址。
  // 当场报错而不是提交时静默丢掉——不然你以为存上了，面试前一刻才发现按钮是灰的。
  if (values.meetingUrl.trim() && !safeExternalUrl(values.meetingUrl)) {
    errors.meetingUrl = "填 http:// 或 https:// 开头的完整地址";
  }
  if (values.resumeUrl.trim() && !safeExternalUrl(values.resumeUrl)) {
    errors.resumeUrl = "填 http:// 或 https:// 开头的完整地址";
  }
  return errors;
}

/**
 * 表单值 → Interview。
 * 用户填的是「面试当地的墙上时间」，这里用第一轮的 utcFromZonedWallClock
 * 换算成 UTC，夏令时交给 Intl，不手写偏移。
 */
export function interviewFromForm(values: InterviewFormValues): NewInterview {
  const [year, month, day] = values.date.split("-").map(Number);

  let startUtc: string;
  let endUtc: string;
  if (values.timePrecision === "date") {
    // 只知道日期：用当天 00:00（面试当地时区）当全天窗口的起点，跟
    // lib/ledgerInterviews.ts 对 ledger 里 date 精度记录的处理是同一套约定，
    // 两处「只知道日期」的事件在数据层长得一样，展示层才能用同一份 DualClock 逻辑。
    startUtc = utcFromZonedWallClock(
      { year, month, day, hour: 0, minute: 0 },
      values.sourceTimeZone,
    );
    endUtc = new Date(Date.parse(startUtc) + 24 * 60 * 60_000).toISOString();
  } else {
    const [hour, minute] = values.time.split(":").map(Number);
    startUtc = utcFromZonedWallClock(
      { year, month, day, hour, minute },
      values.sourceTimeZone,
    );
    endUtc = new Date(
      Date.parse(startUtc) + Number(values.durationMinutes) * 60_000,
    ).toISOString();
  }

  return {
    company: values.company.trim(),
    position: values.position.trim(),
    startUtc,
    endUtc,
    sourceTimeZone: values.sourceTimeZone,
    timePrecision: values.timePrecision,
    // 手填的时区来自下拉菜单里的真实 IANA 名，不是推断兜底，一律算确认过。
    sourceTimeZoneConfirmed: true,
    importance: values.importance,
    type: values.type,
    status: "scheduled",
    subCalendarId: values.subCalendarId,
    location: values.location.trim() || null,
    externalId: null,
    source: "manual",
    prep: {
      // 再挡一道：校验通过才该走到这里，但这层是数据进库的最后关口
      meetingUrl: safeExternalUrl(values.meetingUrl),
      resumeUrl: safeExternalUrl(values.resumeUrl),
      jdNotes: values.jdNotes.trim() || null,
      checklist: [],
    },
  };
}
