/**
 * 全局数据模型。
 *
 * 时间规范（全项目强制）：
 * - 所有时间点以 UTC ISO 8601 字符串存储，字段名一律以 `Utc` 结尾。
 * - 面试所在地时区单独用 IANA 时区名存储（sourceTimeZone）。
 * - 任何地方都不得出现不带时区信息的本地时间字符串。
 */

/** IANA 时区名，如 "America/New_York"。仅作语义标注，运行时由 Intl 校验。 */
export type IanaTimeZone = string;

/** UTC ISO 8601 字符串，如 "2026-08-18T13:30:00.000Z"。 */
export type UtcIsoString = string;

/** 重要度：1 = 随缘，5 = 梦中情司。参与优先级计算。 */
export type Importance = 1 | 2 | 3 | 4 | 5;

/** 面试/笔试类型。 */
export type InterviewType =
  | "video" // 视频面试
  | "onsite" // 现场面试
  | "phone" // 电话面试
  | "assessment" // 在线笔试 / OA
  | "hr"; // HR 初面

/** 流程状态。offer / rejected 为终态，由左右滑手势写入。 */
export type InterviewStatus =
  | "scheduled" // 已排期
  | "completed" // 已面完，等结果
  | "offer" // 拿到 Offer（左滑）
  | "rejected"; // 已挂 / 取消（右滑）

/** 备战信息：第二轮的「一键备战胶囊」消费这些字段，本轮仅存储与展示。 */
export interface PrepInfo {
  /** 会议链接（腾讯会议 / Zoom 等），无则为 null。 */
  meetingUrl: string | null;
  /** 简历 PDF 地址，无则为 null。 */
  resumeUrl: string | null;
  /** 岗位 JD 笔记（纯文本 / Markdown），无则为 null。 */
  jdNotes: string | null;
  /** 面试官、题型等零散备注。 */
  checklist: string[];
}

/** 子日历：一组面试的归类容器，带独立主题色。 */
export interface SubCalendar {
  id: string;
  name: string;
  /** 十六进制颜色，用于视觉标签，如 "#7DB8E8"。 */
  color: string;
  description: string | null;
}

/** 一场面试 / 笔试。 */
export interface Interview {
  id: string;
  company: string;
  position: string;
  /** 开始时间（UTC）。 */
  startUtc: UtcIsoString;
  /** 结束时间（UTC）。 */
  endUtc: UtcIsoString;
  /** 面试所在地时区，展示层用它做双时区换算，夏令时交给 Intl 处理。 */
  sourceTimeZone: IanaTimeZone;
  /**
   * 时间精度：`"timed"` 有具体钟点；`"date"` 只知道日期，`startUtc`/`endUtc`
   * 是「那一天在 sourceTimeZone 下」的全天窗口，不是真实的开始/结束时刻。
   * 展示层必须按这个字段分支——`"date"` 时不得渲染任何具体钟点，
   * 否则就是把「不知道」显示成「知道」，是编造不是兜底。
   */
  timePrecision: "timed" | "date";
  /**
   * `sourceTimeZone` 是不是确认过的（用户手选，或数据源本身带时区），
   * 还是推断失败后的兜底值。为 false 时展示层只能显示一个钟点并明说
   * 「时区未确认」，不能再换算出「你所在地」——那是把不确定的值当成确定的
   * 输入去做二次运算，误差会被放大而不是抵消。
   */
  sourceTimeZoneConfirmed: boolean;
  importance: Importance;
  type: InterviewType;
  status: InterviewStatus;
  /** 所属子日历 id。 */
  subCalendarId: string;
  prep: PrepInfo;
  /** 现场面试的地点，非现场则为 null。 */
  location: string | null;
  /**
   * 外部来源的稳定标识，如 Google Calendar 的 event id 或邮件的 Message-ID。
   * 重复导入时靠它去重；手工创建的为 null。
   */
  externalId?: string | null;
  /** 数据来自哪里，用于在卡片上标注「来自 Google 日历」。 */
  source?: "manual" | "google-calendar" | "gmail" | "ledger";
}

/** 内置主题名。 */
export type ThemeName = "light" | "dark";

/**
 * 一套完整的主题色。字段与 globals.css 里的 --jcc-* 变量一一对应。
 * 为后续「上传图片提取主色调」预留：取色器只需产出这个结构。
 */
export interface ThemeColors {
  canvas: string;
  surface: string;
  raised: string;
  hairline: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  brand: string;
  brandLine: string;
  brandSoft: string;
  onBrandSoft: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
}

/** 滑动手势可触发的两种终态操作。 */
export type SwipeAction = "offer" | "rejected";

/** 手势仲裁结果：一次手势只能锁定其中一种，中途不可切换。 */
export type GestureLock = "none" | "swipe" | "reorder";
