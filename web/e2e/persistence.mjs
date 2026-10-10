/**
 * 持久化验收：新建 → 刷新 → 编辑 → 刷新 → 删除 → 刷新，全程数据正确。
 *
 * 这是 localStorage 方案最容易悄悄坏掉的地方——rehydrate 时机、
 * partialize 漏字段、骨架挡住渲染，任何一处出问题都表现为「刷新后数据不对」，
 * 而单看某一帧的界面是看不出来的。所以每一步之间都真刷新一次。
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const URL = process.env.JCC_URL ?? "http://localhost:3000";
const COMPANY = "Persistence Co";

export async function run(report) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 1400 },
    timezoneId: "America/New_York",
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector("[data-skeleton]"), {
      timeout: 5000,
    });
    await page.waitForTimeout(400);
  };
  const cards = () =>
    page.$$eval("li", (lis) => lis.map((l) => l.innerText.replace(/\n/g, " | ")));
  const card = async () => (await cards()).find((t) => t.includes(COMPANY)) ?? null;
  const reload = async () => {
    await page.reload({ waitUntil: "networkidle" });
    await settle();
  };

  // 把台账钉成固定的两条锚点卡。
  //
  // **不这么做这套验收会随日期慢慢烂掉**：真实 ledger.db 里的记录会一天天变成过去，
  // 全过期之后它们的紧急度全部顶到最高，测试卡无论改成哪天都排在最后一位，
  // 下面第 4.5 步的名次比较就永远不成立——而失败原因和持久化毫无关系。
  // 这套验收测的是 localStorage 的存取，不该依赖作者本机台账当天长什么样。
  const anchor = (id, company, days) => {
    const start = new Date(Date.now() + days * 86_400_000);
    return {
      id: `ledger-${id}`,
      company,
      position: "锚点",
      startUtc: start.toISOString(),
      endUtc: new Date(start.getTime() + 3_600_000).toISOString(),
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
  };
  await page.route("**/api/interviews", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        source: "e2e-stub",
        interviews: [anchor(8001, "锚点近", 3), anchor(8002, "锚点远", 900)],
      }),
    }),
  );

  await page.goto(`${URL}/board`, { waitUntil: "networkidle" });
  await settle();

  // ---------- 1. 新建 ----------
  await page.getByRole("button", { name: "新建面试" }).click();
  await page.getByLabel("公司").fill(COMPANY);
  await page.getByLabel("岗位").fill("第一轮");
  await page.getByLabel("面试当地时区").selectOption("Europe/London");
  await page.getByLabel("日期（当地）").fill("2026-09-01");
  await page.getByLabel("时间（当地）").fill("14:30");
  await page.getByLabel("时长（分钟）").fill("45");
  await page.getByRole("button", { name: "添加到列表" }).click();
  await page.waitForTimeout(500);
  report("新建后立即出现", (await card())?.includes("第一轮") ?? false);

  // ---------- 2. 刷新 ----------
  await reload();
  const afterCreate = await card();
  report("刷新后仍在，且内容未变", Boolean(afterCreate?.includes("第一轮")), afterCreate?.slice(0, 60));
  report(
    "刷新后双时区仍正确（14:30 BST / 09:30 EDT）",
    Boolean(afterCreate?.includes("14:30") && afterCreate?.includes("09:30") && afterCreate?.includes("BST")),
    afterCreate?.match(/BST|EDT|\d\d:\d\d/g)?.join(" "),
  );

  // ---------- 3. 编辑 ----------
  const editAt = async () => {
    const idx = (await cards()).findIndex((t) => t.includes(COMPANY));
    if (idx < 0) throw new Error("找不到目标卡片");
    await (await page.$$('button[aria-label^="编辑 "]'))[idx].click();
    await page.waitForTimeout(300);
  };
  await editAt();
  await page.getByLabel("岗位").fill("第二轮");
  await page.getByLabel("时间（当地）").fill("16:00");
  await page.getByRole("button", { name: "保存" }).click();
  await page.waitForTimeout(500);
  report("编辑后立即生效", (await card())?.includes("第二轮") ?? false);

  // ---------- 4. 刷新 ----------
  await reload();
  const afterEdit = await card();
  report("刷新后编辑结果仍在", Boolean(afterEdit?.includes("第二轮")), afterEdit?.slice(0, 60));
  report("刷新后改过的时间仍正确（16:00 BST / 11:00 EDT）",
    Boolean(afterEdit?.includes("16:00") && afterEdit?.includes("11:00")),
    afterEdit?.match(/\d\d:\d\d/g)?.join(" "));
  report("旧值没有残留", !(afterEdit?.includes("第一轮") ?? true));

  // ---------- 4.5 改时间后自动排序要跟着变 ----------
  // 两次编辑都在测试里给定，不依赖「今天是几号」，也不依赖示例数据的分数：
  // 先推到很久以后（紧急度最低档）拿到基准名次，再拉到明天（最高档），
  // 名次必须往上走。updateInterview 不重排的话两次名次会完全一样。
  // 能这么比的前提是台账已经被钉成上面那两条锚点卡（一近一远），
  // 测试卡才有可以穿过去的位置。
  const indexOf = async () => (await cards()).findIndex((t) => t.includes(COMPANY));
  const setDate = async (value) => {
    await editAt();
    await page.getByLabel("日期（当地）").fill(value);
    await page.getByRole("button", { name: "保存" }).click();
    await page.waitForTimeout(500);
  };
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  await setDate("2029-12-01");
  const rankFar = await indexOf();
  await setDate(tomorrow);
  const rankSoon = await indexOf();
  report(
    "改到明天后，自动排序下要往上冒",
    rankSoon < rankFar,
    `很久以后第 ${rankFar + 1} 位 → 明天第 ${rankSoon + 1} 位`,
  );
  await reload();
  report("新顺序刷新后仍在", (await indexOf()) === rankSoon, `第 ${(await indexOf()) + 1} 位`);

  // ---------- 5. 导出 / 导入往返（备份是 localStorage 唯一兜底）----------
  await page.getByRole("button", { name: "数据备份" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出 JSON" }).click(),
  ]);
  const file = await download.path();
  const backup = JSON.parse(readFileSync(file, "utf8"));
  report("导出的 JSON 含面试、子日历、顺序",
    Array.isArray(backup.interviews) && Array.isArray(backup.subCalendars) && Array.isArray(backup.order),
    `interviews=${backup.interviews?.length} calendars=${backup.subCalendars?.length} order=${backup.order?.length}`);
  report("导出内容包含刚编辑过的那场",
    backup.interviews.some((i) => i.company === COMPANY && i.position === "第二轮"));

  // ---------- 6. 删除 ----------
  await editAt();
  await page.getByRole("button", { name: "删除这场" }).click();
  await page.waitForTimeout(500);
  report("删除后立即消失", (await card()) === null);

  // ---------- 7. 刷新 ----------
  await reload();
  report("刷新后仍是删除状态（没有复活）", (await card()) === null, `剩 ${(await cards()).length} 张`);

  // ---------- 8. 用备份把它导回来 ----------
  await page.getByRole("button", { name: "数据备份" }).click();
  await page.getByLabel("选择备份文件").setInputFiles(file);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "合并（推荐）" }).click();
  await page.waitForTimeout(500);
  report("导入备份后数据恢复", (await card())?.includes("第二轮") ?? false);
  await reload();
  report("导入的数据刷新后仍在", (await card())?.includes("第二轮") ?? false);

  // 清理，别把测试数据留给下一次运行
  await editAt();
  await page.getByRole("button", { name: "删除这场" }).click();
  await page.waitForTimeout(400);

  report("全程无 console error", errors.length === 0, errors.join(";").slice(0, 200));
  await browser.close();
}
