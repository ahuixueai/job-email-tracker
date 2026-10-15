/**
 * 看板的偏好设置（私人看板存在云端，和「你的修改」分开存：清空修改不会把偏好也清掉）。
 * 现在只有日历提醒的提前量；以后的「跟进天数」「深浅色」也放这里。
 */

/** 准点开始（面试、笔试开考）提前多久提醒，单位分钟；null = 不提醒。 */
export const FIXED_ALARM_CHOICES = [null, 30, 60, 120] as const;
/** 截止前完成（测评、补材料）提前多久提醒，单位分钟；null = 不提醒。 */
export const DEADLINE_ALARM_CHOICES = [null, 180, 1440] as const;

export type FixedAlarm = (typeof FIXED_ALARM_CHOICES)[number];
export type DeadlineAlarm = (typeof DEADLINE_ALARM_CHOICES)[number];

export interface BoardPrefs {
  version: 1;
  calendar: { fixedAlarm: FixedAlarm; deadlineAlarm: DeadlineAlarm };
}

export const DEFAULT_PREFS: BoardPrefs = { version: 1, calendar: { fixedAlarm: 60, deadlineAlarm: 1440 } };

/** 读偏好：认不出的字段一律按 base（默认值，或更新时的「现在那份」）来，不报错。 */
export function parsePrefs(value: unknown, base: BoardPrefs = DEFAULT_PREFS): BoardPrefs {
  const v = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const cal = typeof v.calendar === "object" && v.calendar !== null ? (v.calendar as Record<string, unknown>) : {};
  const pick = <T,>(choices: readonly T[], raw: unknown, fallback: T): T => (choices.includes(raw as T) ? (raw as T) : fallback);
  return {
    version: 1,
    calendar: {
      fixedAlarm: "fixedAlarm" in cal ? pick(FIXED_ALARM_CHOICES, cal.fixedAlarm, base.calendar.fixedAlarm) : base.calendar.fixedAlarm,
      deadlineAlarm: "deadlineAlarm" in cal ? pick(DEADLINE_ALARM_CHOICES, cal.deadlineAlarm, base.calendar.deadlineAlarm) : base.calendar.deadlineAlarm,
    },
  };
}

/** 「30 分钟」「1 小时」「1 天」「不提醒」。 */
export function alarmLabel(minutes: number | null): string {
  if (minutes === null) return "不提醒";
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

/** iCalendar 的提前量写法：-PT30M、-PT2H、-P1D。 */
export function alarmDuration(minutes: number): string {
  if (minutes % 1440 === 0) return `-P${minutes / 1440}D`;
  if (minutes % 60 === 0) return `-PT${minutes / 60}H`;
  return `-PT${minutes}M`;
}
