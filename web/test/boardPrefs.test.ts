import { describe, expect, it } from "vitest";
import { alarmDuration, alarmLabel, DEFAULT_PREFS, parsePrefs } from "@/lib/demo/boardPrefs";

describe("看板偏好", () => {
  it("认不出的回到默认；null 是「不提醒」，要保留", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ calendar: { fixedAlarm: 45, deadlineAlarm: "x" } })).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ calendar: { fixedAlarm: null, deadlineAlarm: 180 } }).calendar).toEqual({ fixedAlarm: null, deadlineAlarm: 180 });
    expect(parsePrefs({ calendar: {} }).calendar).toEqual(DEFAULT_PREFS.calendar);
    // 更新时：没给 / 乱给的字段保持现在的值
    const now = parsePrefs({ calendar: { fixedAlarm: 30, deadlineAlarm: null } });
    expect(parsePrefs({ calendar: { fixedAlarm: 120 } }, now).calendar).toEqual({ fixedAlarm: 120, deadlineAlarm: null });
    expect(parsePrefs({ calendar: { fixedAlarm: 7 } }, now).calendar).toEqual({ fixedAlarm: 30, deadlineAlarm: null });
  });
  it("显示和 iCalendar 写法", () => {
    expect([null, 30, 60, 120, 180, 1440].map(alarmLabel)).toEqual(["不提醒", "30 分钟", "1 小时", "2 小时", "3 小时", "1 天"]);
    expect([30, 120, 1440].map(alarmDuration)).toEqual(["-PT30M", "-PT2H", "-P1D"]);
  });
});
