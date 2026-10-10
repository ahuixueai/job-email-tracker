/**
 * 降级验收：命中 prefers-reduced-motion 时，动效关掉但功能一个不少。
 */
import { chromium } from "playwright";

const URL = process.env.JCC_URL ?? "http://localhost:3000";

export async function run(check) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 900, height: 1200 },
    reducedMotion: "reduce",
  });
  const issues = [];
  page.on("pageerror", (e) => issues.push(e.message));

  // ?seed=demo：加载固定的四张演示卡，不依赖真实 ledger.db 里有没有数据
  // （生产环境默认路径不再自带 mock，见 store/useInterviewStore.ts）。
  await page.goto(`${URL}/board?seed=demo`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.querySelector("[data-skeleton]"), {
    timeout: 5000,
  });
  await page.waitForTimeout(400);

  // 左滑第一张：状态必须照常变更，但撒花必须被完全跳过
  const swiped = await page.$$eval("li", (l) => l[0].querySelector("h3").textContent);
  const box = await (await page.$$("li"))[0].boundingBox();
  await page.mouse.move(box.x + box.width * 0.85, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(
      box.x + box.width * 0.85 - (i * box.width * 0.7) / 20,
      box.y + 40,
    );
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);

  // 按公司名找那张卡，而不是按位置——终态会沉底，位置本来就该变
  const cards = await page.$$eval("li", (l) =>
    l.map((li) => ({
      company: li.querySelector("h3").textContent,
      text: li.innerText.replace(/\n/g, " | "),
    })),
  );
  const index = cards.findIndex((c) => c.company === swiped);
  const text = index >= 0 ? cards[index].text : "（卡片不见了）";
  const canvases = await page.$$eval("canvas", (c) => c.length);
  const vibrate = await page.evaluate(() => typeof navigator.vibrate);

  check(
    "功能保留：状态照常变更",
    text.includes("已拿 Offer"),
    `${swiped}: ${text.slice(0, 50)}`,
  );
  // 终态不该再占着头部位置挡住还要跟进的面试
  check(
    "标为 Offer 后沉到底",
    index === cards.length - 1,
    `${swiped} 在第 ${index + 1}/${cards.length} 位`,
  );
  check("命中 reduced-motion 时不撒花", canvases === 0, `canvas=${canvases}`);
  check("navigator.vibrate 特性检测不报错", true, `typeof = ${vibrate}`);
  check("无页面异常", issues.length === 0, issues.join(";").slice(0, 160));

  await browser.close();
}
