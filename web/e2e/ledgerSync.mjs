/**
 * 台账持续同步验收：ledger.db 改了之后，已经落进 localStorage 的卡片跟不跟着变。
 *
 * 单测（test/ledgerSync.test.ts）钉的是纯 reducer，这里钉的是**整条链路**：
 * `/api/interviews` 回来的内容变了 → 刷新一次 → 界面上的卡片真的跟着变。
 * 中间隔着 rehydrate 时机、persist 写回、effect 依赖三处，任何一处错了单测都看不出来。
 *
 * 用 route 拦截造台账，不碰真实 ledger.db——验收不该有写库的副作用。
 */
import { chromium } from "playwright";

const URL = process.env.JCC_URL ?? "http://localhost:3000";

/** 明天，避开「已逾期」标记与当天边界。 */
const DAY = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

function ledgerCard(id, company, hourUtc) {
  return {
    id: `ledger-${id}`,
    company,
    position: "同步验收",
    startUtc: `${DAY}T${String(hourUtc).padStart(2, "0")}:00:00.000Z`,
    endUtc: `${DAY}T${String(hourUtc + 1).padStart(2, "0")}:00:00.000Z`,
    sourceTimeZone: "Asia/Shanghai",
    timePrecision: "timed",
    sourceTimeZoneConfirmed: true,
    importance: 3,
    type: "video",
    status: "scheduled",
    subCalendarId: "cal-ledger",
    location: null,
    externalId: `ledger-${id}`,
    source: "ledger",
    prep: { meetingUrl: null, resumeUrl: null, jdNotes: null, checklist: [] },
  };
}

export async function run(report) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 1400 },
    timezoneId: "America/New_York",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 台账的当前内容，两次刷新之间就改这个变量
  let interviews = [ledgerCard(9001, "同步甲", 6), ledgerCard(9002, "同步乙", 8)];
  await page.route("**/api/interviews", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, source: "e2e-stub", interviews }),
    }),
  );

  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector("[data-skeleton]"), {
      timeout: 5000,
    });
    await page.waitForTimeout(400);
  };
  const cards = () =>
    page.$$eval("li", (lis) => lis.map((l) => l.innerText.replace(/\n/g, " | ")));
  const cardOf = async (name) => (await cards()).find((t) => t.includes(name)) ?? null;

  await page.goto(`${URL}/board`, { waitUntil: "networkidle" });
  await settle();

  report("台账两条 → 看板两张卡", Boolean(await cardOf("同步甲")) && Boolean(await cardOf("同步乙")));
  // 06:00Z = 北京 14:00
  report("首次同步的时间正确（14:00 CST）", (await cardOf("同步甲"))?.includes("14:00") ?? false,
    (await cardOf("同步甲"))?.match(/\d\d:\d\d/g)?.join(" "));

  // ---------- 台账改了：甲的时间变了，乙被关掉了 ----------
  interviews = [ledgerCard(9001, "同步甲", 10)];
  await page.reload({ waitUntil: "networkidle" });
  await settle();

  const updated = await cardOf("同步甲");
  // 10:00Z = 北京 18:00
  report("台账改了时间，刷新后卡片跟着变（18:00 CST）", updated?.includes("18:00") ?? false,
    updated?.match(/\d\d:\d\d/g)?.join(" "));
  report("旧时间没有残留", !(updated?.includes("14:00") ?? true));
  report("卡片没有被复制成两张", (await cards()).filter((t) => t.includes("同步甲")).length === 1);
  report("台账里不再出现的记录，卡片要消失", (await cardOf("同步乙")) === null);

  // ---------- 台账清空：卡片全部消失 ----------
  interviews = [];
  await page.reload({ waitUntil: "networkidle" });
  await settle();
  report("台账清空后，台账来源的卡片全部消失", (await cardOf("同步甲")) === null);

  report("无页面异常", errors.length === 0, errors[0]);
  await browser.close();
}
