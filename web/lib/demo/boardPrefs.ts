/**
 * 看板的偏好设置（私人看板存在云端，和「你的修改」分开存：清空修改不会把偏好也清掉）。
 * 现在有：日历提醒的提前量、邮件提醒开关、两个时区（你在哪、你在哪找工作），和最近一次打开看板时设备的时区。
 */

/** 准点开始（面试、笔试开考）提前多久提醒，单位分钟；null = 不提醒。 */
export const FIXED_ALARM_CHOICES = [null, 30, 60, 120] as const;
/** 截止前完成（测评、补材料）提前多久提醒，单位分钟；null = 不提醒。 */
export const DEADLINE_ALARM_CHOICES = [null, 180, 1440] as const;

export type FixedAlarm = (typeof FIXED_ALARM_CHOICES)[number];
export type DeadlineAlarm = (typeof DEADLINE_ALARM_CHOICES)[number];

/**
 * 求职地：只能选一个。没写时区的招聘邮件按它换算（引擎时区推断的最后一条线索）。
 * 香港、新加坡这类例外，靠「以后这家公司都按…」单独记。
 */
export const JOB_ZONE_CHOICES = [
  { zone: "Asia/Shanghai", label: "中国大陆", clock: "北京时间" },
  { zone: "Asia/Hong_Kong", label: "中国香港", clock: "香港时间" },
  { zone: "Asia/Singapore", label: "新加坡", clock: "新加坡时间" },
] as const;

/** 「你在哪」的常用选项（留学生常在的地方）；不在表里的时区跟随设备时也能用。 */
export const HOME_ZONE_CHOICES = [
  { zone: "America/New_York", label: "美国东部（纽约、波士顿）" },
  { zone: "America/Chicago", label: "美国中部（芝加哥）" },
  { zone: "America/Denver", label: "美国山地（丹佛）" },
  { zone: "America/Los_Angeles", label: "美国西部（洛杉矶、西雅图）" },
  { zone: "America/Toronto", label: "加拿大东部（多伦多）" },
  { zone: "America/Vancouver", label: "加拿大西部（温哥华）" },
  { zone: "Europe/London", label: "英国" },
  { zone: "Europe/Paris", label: "欧洲中部（巴黎、柏林）" },
  { zone: "Australia/Sydney", label: "澳大利亚东部（悉尼、墨尔本）" },
  { zone: "Asia/Tokyo", label: "日本" },
  { zone: "Asia/Singapore", label: "新加坡" },
  { zone: "Asia/Hong_Kong", label: "中国香港" },
  { zone: "Asia/Shanghai", label: "中国大陆" },
] as const;

export interface TimeZonePrefs {
  /** 你在哪：看板上的时间按它显示。null = 跟随这台设备。 */
  home: string | null;
  /** 你在哪找工作（IANA 名，取自 JOB_ZONE_CHOICES）。null = 还没设置：登录后会请你选一次。 */
  job: string | null;
}

export interface BoardPrefs {
  version: 1;
  /** emailReminders：面试前一晚、截止前 24 / 3 小时发邮件提醒（默认开）。 */
  calendar: { fixedAlarm: FixedAlarm; deadlineAlarm: DeadlineAlarm; emailReminders: boolean };
  timeZones: TimeZonePrefs;
  /**
   * 最近一次打开看板时设备的时区（看板自动记，不是你选的）。
   * 「你在哪」选了「跟随设备」时，服务端靠它算「前一天晚上 8 点」该什么时候发提醒。
   */
  deviceZone: string | null;
}

export const DEFAULT_PREFS: BoardPrefs = {
  version: 1,
  // 10/19 作者定：面试、笔试开始前 30 分钟由日历提醒（前一晚的那封交给邮件）
  calendar: { fixedAlarm: 30, deadlineAlarm: 1440, emailReminders: true },
  timeZones: { home: null, job: null },
  deviceZone: null,
};

/** 邮件提醒按哪个时区算「晚上 8 点」「今天 / 明天」：你选的 → 设备的 → 求职地 → 北京时间。 */
export function reminderZone(prefs: BoardPrefs): string {
  return prefs.timeZones.home ?? prefs.deviceZone ?? prefs.timeZones.job ?? "Asia/Shanghai";
}

/** 浏览器认不认得这个时区名。 */
export function isZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** 看板实际用来显示的时区：设置了就用设置的，否则跟随设备。 */
export function effectiveHomeZone(prefs: TimeZonePrefs, deviceZone: string): string {
  return prefs.home ?? deviceZone;
}

export function jobZoneLabel(zone: string | null): string {
  return JOB_ZONE_CHOICES.find((c) => c.zone === zone)?.label ?? "还没设置";
}

/** 读偏好：认不出的字段一律按 base（默认值，或更新时的「现在那份」）来，不报错。 */
export function parsePrefs(value: unknown, base: BoardPrefs = DEFAULT_PREFS): BoardPrefs {
  const v = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const cal = typeof v.calendar === "object" && v.calendar !== null ? (v.calendar as Record<string, unknown>) : {};
  const tz = typeof v.timeZones === "object" && v.timeZones !== null ? (v.timeZones as Record<string, unknown>) : {};
  const pick = <T,>(choices: readonly T[], raw: unknown, fallback: T): T => (choices.includes(raw as T) ? (raw as T) : fallback);
  const jobZones: readonly string[] = JOB_ZONE_CHOICES.map((c) => c.zone);
  return {
    version: 1,
    calendar: {
      fixedAlarm: "fixedAlarm" in cal ? pick(FIXED_ALARM_CHOICES, cal.fixedAlarm, base.calendar.fixedAlarm) : base.calendar.fixedAlarm,
      deadlineAlarm: "deadlineAlarm" in cal ? pick(DEADLINE_ALARM_CHOICES, cal.deadlineAlarm, base.calendar.deadlineAlarm) : base.calendar.deadlineAlarm,
      emailReminders: typeof cal.emailReminders === "boolean" ? cal.emailReminders : base.calendar.emailReminders,
    },
    timeZones: {
      // null 是「跟随设备」，要保留；乱给的保持现在的值
      home: "home" in tz ? (tz.home === null ? null : isZone(tz.home) ? tz.home : base.timeZones.home) : base.timeZones.home,
      // 求职地设了就不能清空（没有「不设置」这一项）；只认表里的几个
      job: "job" in tz && typeof tz.job === "string" && jobZones.includes(tz.job) ? tz.job : base.timeZones.job,
    },
    deviceZone: isZone(v.deviceZone) ? v.deviceZone : base.deviceZone,
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
