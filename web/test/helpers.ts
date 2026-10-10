import type { Interview, SubCalendar } from "@/types";
import type { BoardData } from "@/store/reducers";

/** 测试基准时刻：2026-09-01T00:00:00Z。所有相对时间都从它算。 */
export const NOW = Date.parse("2026-09-01T00:00:00Z");

export function hoursFromNow(hours: number): string {
  return new Date(NOW + hours * 3_600_000).toISOString();
}

/** 造一条面试。只写关心的字段，其余给合理默认值。 */
export function makeInterview(patch: Partial<Interview> & { id: string }): Interview {
  return {
    company: patch.id,
    position: "分析师",
    startUtc: hoursFromNow(24 * 30),
    endUtc: hoursFromNow(24 * 30 + 1),
    sourceTimeZone: "Asia/Shanghai",
    timePrecision: "timed",
    sourceTimeZoneConfirmed: true,
    importance: 3,
    type: "video",
    status: "scheduled",
    subCalendarId: "cal-1",
    location: null,
    externalId: null,
    source: "manual",
    prep: { meetingUrl: null, resumeUrl: null, jdNotes: null, checklist: [] },
    ...patch,
  };
}

export const CAL: SubCalendar = {
  id: "cal-1",
  name: "秋招",
  color: "#3f83b5",
  description: null,
};

/** 造一份 board 状态，order 按传入顺序，默认非手动排序。 */
export function makeBoard(
  interviews: Interview[],
  patch: Partial<BoardData> = {},
): BoardData {
  return {
    interviews,
    subCalendars: [CAL],
    order: interviews.map((i) => i.id),
    manualOrder: false,
    prepSnoozeUntil: {},
    filterCalendarId: null,
    ...patch,
  };
}
