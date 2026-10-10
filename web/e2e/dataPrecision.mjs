/**
 * 数据精度验收：只知道日期、或时区没确认过的面试，卡片上不能画出编造的钟点/时区。
 *
 * 这是修一个真 bug 后补的回归测试——DualClock 曾经无条件按具体钟点渲染，
 * 不看 timePrecision 也不看 sourceTimeZoneConfirmed。三种组合各建一张卡，
 * 直接注入 localStorage（不走表单，因为手动表单永远产出 sourceTimeZoneConfirmed
 * = true，测不出「时区未确认」这条分支——这个分支只有 ledger 同步在区域推断
 * 失败时才会产生）。
 */
import { chromium } from "playwright";

const URL = process.env.JCC_URL ?? "http://localhost:3000";

const CAL_ID = "cal-precision-test";
const COMPANY_TIMED_CONFIRMED = "精度测试-已确认时区";
const COMPANY_TIMED_UNCONFIRMED = "精度测试-未确认时区";
const COMPANY_DATE = "精度测试-只知道日期";

function board() {
  const start = new Date(Date.now() + 5 * 86_400_000);
  start.setUTCHours(6, 0, 0, 0); // 固定钟点，不落在 UTC 日期边界附近
  const startUtc = start.toISOString();
  const endUtc = new Date(start.getTime() + 3_600_000).toISOString();

  const base = {
    position: "岗位",
    startUtc,
    endUtc,
    importance: 3,
    type: "video",
    status: "scheduled",
    subCalendarId: CAL_ID,
    location: null,
    externalId: null,
    source: "manual",
    prep: { meetingUrl: null, resumeUrl: null, jdNotes: null, checklist: [] },
  };

  const interviews = [
    {
      ...base,
      id: "itv-precision-1",
      company: COMPANY_TIMED_CONFIRMED,
      sourceTimeZone: "America/New_York",
      timePrecision: "timed",
      sourceTimeZoneConfirmed: true,
    },
    {
      ...base,
      id: "itv-precision-2",
      company: COMPANY_TIMED_UNCONFIRMED,
      sourceTimeZone: "Asia/Shanghai",
      timePrecision: "timed",
      sourceTimeZoneConfirmed: false,
    },
    {
      ...base,
      id: "itv-precision-3",
      company: COMPANY_DATE,
      sourceTimeZone: "Asia/Shanghai",
      timePrecision: "date",
      sourceTimeZoneConfirmed: false,
    },
  ];

  return {
    interviews,
    subCalendars: [{ id: CAL_ID, name: "精度测试", color: "#7DB8E8", description: null }],
    order: interviews.map((i) => i.id),
    manualOrder: true, // 手动排序：不让优先级重排把这三张卡的相对位置打乱
    prepSnoozeUntil: {},
    filterCalendarId: null,
  };
}

export async function run(check) {
  const browser = await chromium.launch();
  // 显式钉死浏览器时区，不依赖跑测试的机器恰好在哪个时区——
  // 否则「已确认时区」那张卡如果和宿主机时区撞上，"你所在地" 列会被
  // DualClock 正确地判定为「相同时区不重复显示」，反而让断言失真。
  const page = await browser.newPage({
    viewport: { width: 900, height: 1400 },
    timezoneId: "Asia/Tokyo",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.addInitScript((state) => {
    localStorage.setItem("jcc-board", JSON.stringify({ state, version: 1 }));
  }, board());

  await page.goto(`${URL}/board`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector("[data-skeleton]"), {
    timeout: 8000,
  });
  await page.waitForTimeout(800);

  const cardText = async (company) =>
    page.$$eval(
      "li",
      (lis, name) => {
        const li = lis.find((l) => l.querySelector("h3")?.textContent === name);
        return li ? li.innerText.replace(/\n/g, " | ") : null;
      },
      company,
    );

  // ---------- timed + 已确认：双时区照常，不受这轮改动影响 ----------
  const confirmed = await cardText(COMPANY_TIMED_CONFIRMED);
  check(
    "timed + 时区已确认：仍显示双时区（面试当地 + 你所在地）",
    Boolean(confirmed?.includes("面试当地") && confirmed?.includes("你所在地")),
    confirmed?.slice(0, 120),
  );
  check(
    "timed + 时区已确认：不出现『时区未确认』或『全天』",
    Boolean(confirmed && !confirmed.includes("时区未确认") && !confirmed.includes("全天")),
    confirmed?.slice(0, 120),
  );

  // ---------- timed + 未确认：只画一个钟点，明说未确认，没有『你所在地』 ----------
  const unconfirmed = await cardText(COMPANY_TIMED_UNCONFIRMED);
  check(
    "timed + 时区未确认：只有『面试当地』一栏，没有『你所在地』",
    Boolean(unconfirmed?.includes("面试当地") && !unconfirmed?.includes("你所在地")),
    unconfirmed?.slice(0, 120),
  );
  check(
    "timed + 时区未确认：明说『时区未确认』",
    Boolean(unconfirmed?.includes("时区未确认")),
    unconfirmed?.slice(0, 120),
  );
  check(
    "timed + 时区未确认：仍然画出了那一个钟点（不是完全不显示）",
    Boolean(unconfirmed?.match(/\d\d:\d\d/)),
    unconfirmed?.slice(0, 120),
  );

  // ---------- date：不画任何钟点，不出现『面试当地/你所在地』标签 ----------
  const dateOnly = await cardText(COMPANY_DATE);
  check(
    "date 精度：不出现『面试当地』或『你所在地』标签",
    Boolean(dateOnly && !dateOnly.includes("面试当地") && !dateOnly.includes("你所在地")),
    dateOnly?.slice(0, 120),
  );
  check(
    "date 精度：显示『全天』，不画任何 HH:MM 钟点",
    Boolean(dateOnly?.includes("全天") && !dateOnly.match(/\d\d:\d\d/)),
    dateOnly?.slice(0, 120),
  );
  check(
    "date 精度：不出现编造的『24 小时』时长文案",
    Boolean(dateOnly && !dateOnly.includes("24 小时")),
    dateOnly?.slice(0, 120),
  );

  check("全程无 console 报错", errors.length === 0, errors.join(";").slice(0, 200));

  await browser.close();
}
