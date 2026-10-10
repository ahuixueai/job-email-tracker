import type { Interview, SubCalendar } from "@/types";
import { utcFromZonedWallClock } from "@/lib/time";

/**
 * Mock 数据全部相对「今天的 UTC 零点」生成，而不是相对 Date.now()。
 * 这样服务端渲染与客户端 hydration 落在同一个 UTC 日历日时结果完全一致，
 * 不会因为两次求值差几毫秒而产生 hydration mismatch。
 */
function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** 以今天 UTC 零点为基准，取 N 天后那一天在指定时区的墙上时间。 */
function inDays(
  days: number,
  timeZone: string,
  hour: number,
  minute = 0,
): string {
  const base = todayUtcMidnight();
  base.setUTCDate(base.getUTCDate() + days);
  return utcFromZonedWallClock(
    {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
      hour,
      minute,
    },
    timeZone,
  );
}

export const MOCK_SUB_CALENDARS: SubCalendar[] = [
  {
    id: "cal-autumn-da",
    name: "秋招 - 数据分析岗",
    color: "#7DB8E8",
    description: "2026 秋招主线，数据分析 / BI 方向",
  },
  {
    id: "cal-backup",
    name: "备选 - 产品运营",
    color: "#FFC93C",
    description: "投着玩的，面到再说",
  },
];

/**
 * 「即将开始」的演示卡片 id。
 *
 * 它的开始时间不能写死在 mock 里：mock 模块在服务端只求值一次（模块缓存），
 * 服务器跑了两小时之后这条就变成「两小时前开始」，而客户端求值是新的，
 * 两边必然对不上 → hydration mismatch。所以这里给一个确定性的占位时间，
 * 真正的「25 分钟后」由 store 的 activateImminentDemo 在挂载后写入。
 */
export const IMMINENT_DEMO_ID = "itv-bytedance-final";

export const MOCK_INTERVIEWS: Interview[] = [
  {
    id: IMMINENT_DEMO_ID,
    company: "字节跳动",
    position: "数据分析 · 三面",
    // 占位值：挂载后由 activateImminentDemo 改写成「25 分钟后」。
    // 必须锚在明天而不是今天——锚今天的话，一旦当前时刻已经过了那个钟点，
    // hydration 之前的首帧就会显示「已开始」，是个说不通的状态。
    startUtc: inDays(1, "Asia/Shanghai", 9, 0),
    endUtc: inDays(1, "Asia/Shanghai", 9, 45),
    sourceTimeZone: "Asia/Shanghai",
    timePrecision: "timed",
    sourceTimeZoneConfirmed: true,
    importance: 4,
    type: "video",
    status: "scheduled",
    subCalendarId: "cal-autumn-da",
    location: null,
    prep: {
      meetingUrl: "https://meeting.tencent.com/dm/mock-bytedance",
      resumeUrl: "/mock/resume-da.pdf",
      jdNotes: "三面是部门负责人，会问项目取舍和指标口径的分歧怎么解决。",
      checklist: ["把埋点方案那页翻出来", "水杯", "提前 3 分钟进会"],
    },
  },
  {
    id: "itv-stripe-da",
    company: "Stripe",
    position: "Data Analyst, Growth",
    startUtc: inDays(1, "America/New_York", 9, 30),
    endUtc: inDays(1, "America/New_York", 10, 30),
    sourceTimeZone: "America/New_York",
    timePrecision: "timed",
    sourceTimeZoneConfirmed: true,
    importance: 5,
    type: "video",
    status: "scheduled",
    subCalendarId: "cal-autumn-da",
    location: null,
    prep: {
      meetingUrl: "https://zoom.us/j/8100000001",
      resumeUrl: "/mock/resume-da.pdf",
      jdNotes:
        "重点：留存分析、A/B 实验读数、SQL 窗口函数。面试官是 Growth 组的 EM。",
      checklist: ["复盘一个自己做过的实验", "准备两个反问", "提前 5 分钟进会议室"],
    },
  },
  {
    id: "itv-airbnb-oa",
    company: "Airbnb",
    position: "Business Analyst 在线笔试",
    startUtc: inDays(5, "America/Los_Angeles", 10, 0),
    endUtc: inDays(5, "America/Los_Angeles", 11, 30),
    sourceTimeZone: "America/Los_Angeles",
    timePrecision: "timed",
    sourceTimeZoneConfirmed: true,
    importance: 3,
    type: "assessment",
    status: "scheduled",
    subCalendarId: "cal-autumn-da",
    location: null,
    prep: {
      meetingUrl: null,
      resumeUrl: "/mock/resume-da.pdf",
      jdNotes: "90 分钟限时，SQL + 案例分析各一半，一旦开始不能暂停。",
      checklist: ["刷 10 道窗口函数", "检查网络", "关掉所有通知"],
    },
  },
  {
    id: "itv-monzo-hr",
    company: "Monzo",
    position: "Analytics Engineer",
    startUtc: inDays(21, "Europe/London", 15, 0),
    endUtc: inDays(21, "Europe/London", 15, 30),
    sourceTimeZone: "Europe/London",
    timePrecision: "timed",
    sourceTimeZoneConfirmed: true,
    importance: 2,
    type: "hr",
    status: "scheduled",
    subCalendarId: "cal-backup",
    location: null,
    prep: {
      meetingUrl: "https://meeting.tencent.com/dm/mock-monzo",
      resumeUrl: "/mock/resume-ae.pdf",
      jdNotes: "HR 初面，聊经历和签证，30 分钟。",
      checklist: ["准备一段两分钟自我介绍", "确认签证口径"],
    },
  },
];
