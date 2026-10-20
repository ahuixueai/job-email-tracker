import { describe, expect, it } from "vitest";
import { alarmDuration, alarmLabel, DEFAULT_PREFS, effectiveHomeZone, jobZoneLabel, parsePrefs, reminderZone } from "@/lib/demo/boardPrefs";

describe("看板偏好", () => {
  it("认不出的回到默认；null 是「不提醒」，要保留", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ calendar: { fixedAlarm: 45, deadlineAlarm: "x" } })).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ calendar: { fixedAlarm: null, deadlineAlarm: 180 } }).calendar).toEqual({ fixedAlarm: null, deadlineAlarm: 180, emailReminders: true });
    expect(parsePrefs({ calendar: {} }).calendar).toEqual(DEFAULT_PREFS.calendar);
    // 更新时：没给 / 乱给的字段保持现在的值
    const now = parsePrefs({ calendar: { fixedAlarm: 30, deadlineAlarm: null } });
    expect(parsePrefs({ calendar: { fixedAlarm: 120 } }, now).calendar).toEqual({ fixedAlarm: 120, deadlineAlarm: null, emailReminders: true });
    expect(parsePrefs({ calendar: { fixedAlarm: 7 } }, now).calendar).toEqual({ fixedAlarm: 30, deadlineAlarm: null, emailReminders: true });
  });
  it("显示和 iCalendar 写法", () => {
    expect([null, 30, 60, 120, 180, 1440].map(alarmLabel)).toEqual(["不提醒", "30 分钟", "1 小时", "2 小时", "3 小时", "1 天"]);
    expect([30, 120, 1440].map(alarmDuration)).toEqual(["-PT30M", "-PT2H", "-P1D"]);
  });
  it("时区：你在哪（null = 跟随设备）、求职地（只认表里的，设了不能清空）", () => {
    expect(DEFAULT_PREFS.timeZones).toEqual({ home: null, job: null });
    const set = parsePrefs({ timeZones: { home: "America/New_York", job: "Asia/Shanghai" } });
    expect(set.timeZones).toEqual({ home: "America/New_York", job: "Asia/Shanghai" });
    // 乱给的保持现在的值
    expect(parsePrefs({ timeZones: { home: "Mars/Base", job: "Asia/Tokyo" } }, set).timeZones).toEqual(set.timeZones);
    expect(parsePrefs({ timeZones: { job: null } }, set).timeZones.job).toBe("Asia/Shanghai");
    // 改回跟随设备
    expect(parsePrefs({ timeZones: { home: null } }, set).timeZones.home).toBeNull();
    // 只改日历，时区不动
    expect(parsePrefs({ calendar: { fixedAlarm: 30 } }, set).timeZones).toEqual(set.timeZones);
    expect(effectiveHomeZone({ home: null, job: null }, "Europe/London")).toBe("Europe/London");
    expect(effectiveHomeZone(set.timeZones, "Europe/London")).toBe("America/New_York");
    expect(jobZoneLabel("Asia/Hong_Kong")).toBe("中国香港");
    expect(jobZoneLabel(null)).toBe("还没设置");
  });
});

describe("邮件提醒开关、设备时区", () => {
  it("默认开着；认不出的值保持原样", () => {
    expect(DEFAULT_PREFS.calendar.emailReminders).toBe(true);
    const off = parsePrefs({ calendar: { emailReminders: false } });
    expect(off.calendar.emailReminders).toBe(false);
    expect(parsePrefs({ calendar: { emailReminders: "no" } }, off).calendar.emailReminders).toBe(false);
  });

  it("提醒按哪个时区算：你选的 → 设备的 → 求职地 → 北京时间", () => {
    expect(reminderZone(DEFAULT_PREFS)).toBe("Asia/Shanghai");
    expect(reminderZone(parsePrefs({ timeZones: { job: "Asia/Singapore" } }))).toBe("Asia/Singapore");
    expect(reminderZone(parsePrefs({ deviceZone: "America/New_York", timeZones: { job: "Asia/Singapore" } }))).toBe("America/New_York");
    expect(reminderZone(parsePrefs({ deviceZone: "America/New_York", timeZones: { home: "Europe/London" } }))).toBe("Europe/London");
    expect(parsePrefs({ deviceZone: "Mars/Base" }).deviceZone).toBeNull();
  });
});
