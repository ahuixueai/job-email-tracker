/** 第一轮定下的手势契约，之后每轮都要保证没被破坏。 */
import { chromium } from "playwright";

const URL = process.env.JCC_URL ?? "http://localhost:3000";
export async function run(ok) {
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const consoleIssues = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") consoleIssues.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => consoleIssues.push(`pageerror: ${e.message}`));

// ?seed=demo：加载固定的四张演示卡，不依赖真实 ledger.db 里有没有数据
// （生产环境默认路径不再自带 mock，见 store/useInterviewStore.ts）。
await page.goto(`${URL}/board?seed=demo`, { waitUntil: "networkidle" });
await page.waitForFunction(() => !document.querySelector("[data-skeleton]"), { timeout: 5000 });
await page.waitForTimeout(900); // 等演示卡片的备战胶囊展开动画落定

const cardTitles = () =>
  page.$$eval("li", (lis) =>
    lis.map(
      (li) =>
        li.innerText
          .split("\n")
          .find((t) => /字节跳动|Stripe|Airbnb|Monzo/.test(t)) ?? "?",
    ),
  );
const statusOf = (i) =>
  page.$$eval("li", (lis, idx) => lis[idx].innerText.replace(/\n/g, " | "), i);

// 从公司名的 title tooltip 里读优先级得分："优先级得分 115 / 125"
const scores = () =>
  page.$$eval("li h3[title]", (els) =>
    els.map((e) => Number(/优先级得分 (\d+)/.exec(e.getAttribute("title"))?.[1] ?? -1)));

const boxOf = async (i) => {
  const li = (await page.$$("li"))[i];
  // 页头变高后卡片可能落在视口外，boundingBox 的坐标就会超出可点击范围
  await li.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  return await li.boundingBox();
};

// ---- 1. 初始顺序应按优先级降序 ----
const initial = await cardTitles();
const initialScores = await scores();
ok("初始按优先级得分降序排列",
  initialScores.length === 4 &&
    initialScores.every((v, i) => i === 0 || initialScores[i - 1] >= v),
  `${JSON.stringify(initial)} → ${JSON.stringify(initialScores)}`);

// ---- 1b. 双时区渲染 ----
{
  const text = await page.$$eval("li", (lis) => lis.map((l) => l.innerText).join(" "));
  ok("双时区并排显示带缩写", /EDT|EST/.test(text) && /PDT|PST/.test(text), text.match(/E[SD]T|P[SD]T|GMT\+?\d?/g)?.join(",") ?? "");
}

// ---- 2. 小幅水平滑动（< 40%）应回弹，不改状态 ----
{
  const box = await boxOf(1);
  await page.mouse.move(box.x + box.width * 0.7, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + box.width * 0.7 - i * 6, box.y + 40);
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
  const s = await statusOf(1);
  ok("未达阈值的水平滑动：回弹归位、状态不变",
    s.includes("已排期") && !s.includes("已拿 Offer"), s.slice(0, 50));
}

// ---- 3. 垂直拖拽 = 排序，且不触发状态操作 ----
{
  const before = await cardTitles();
  const box = await boxOf(0);
  const target = await boxOf(1);
  await page.mouse.move(box.x + box.width * 0.5, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + 40 + (i * (target.height + 12)) / 20);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
  const after = await cardTitles();
  const allScheduled = (await Promise.all([0, 1, 2].map(statusOf))).every((s) => !/已拿 Offer|已结束/.test(s));
  const swapped = [before[1], before[0], ...before.slice(2)];
  ok("垂直拖拽触发排序（首张与次张交换）",
    JSON.stringify(after) === JSON.stringify(swapped),
    `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  ok("排序手势不串扰：无卡片被误标为 Offer / 已挂", allScheduled);
}

// ---- 4. 左滑越过阈值 = 拿到 Offer + 撒花 ----
{
  const beforeSwipe = await cardTitles();
  const box = await boxOf(0);
  await page.mouse.move(box.x + box.width * 0.85, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(box.x + box.width * 0.85 - i * (box.width * 0.7) / 24, box.y + 40);
    await page.waitForTimeout(14);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
  const s = await statusOf(0);
  const hasCanvas = await page.$$eval("canvas", (c) => c.length);
  ok("左滑越阈值 → 标记为已拿 Offer", s.includes("已拿 Offer"), s.slice(0, 60));
  ok("左滑触发 canvas-confetti（页面出现 canvas 画布）", hasCanvas > 0, `canvas=${hasCanvas}`);
  const order = await cardTitles();
  ok("左滑不串扰：列表顺序未变", JSON.stringify(order) === JSON.stringify(beforeSwipe), JSON.stringify(order));
}

// ---- 5. 右滑越过阈值 = 已挂 + 灰度 + 高度折叠 ----
{
  const before = await boxOf(2);
  const box = before;
  await page.mouse.move(box.x + box.width * 0.15, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(box.x + box.width * 0.15 + i * (box.width * 0.7) / 24, box.y + 40);
    await page.waitForTimeout(14);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const s = await statusOf(2);
  const after = await boxOf(2);
  const filter = await page.$$eval("li", (lis) => getComputedStyle(lis[2].firstElementChild.lastElementChild).filter);
  ok("右滑越阈值 → 标记为已结束", s.includes("已结束"), s.slice(0, 60));
  ok("右滑后高度折叠", after.height < before.height * 0.75, `${Math.round(before.height)} → ${Math.round(after.height)}`);
  ok("右滑后灰度化", /grayscale\(1\)|grayscale/.test(filter) || filter !== "none", filter);
}

// ---- 6. 键盘替代路径：Alt + ↑ 调整顺序 ----
{
  const beforeKey = await cardTitles();
  await page.$$eval("li", (lis) => lis[1].focus());
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.up("Alt");
  await page.waitForTimeout(600);
  const after = await cardTitles();
  const expected = [beforeKey[1], beforeKey[0], ...beforeKey.slice(2)];
  ok("键盘 Alt + ↑ 可调整顺序",
    JSON.stringify(after) === JSON.stringify(expected),
    `${JSON.stringify(beforeKey)} → ${JSON.stringify(after)}`);
}

// ---- 8. 控制台干净 ----
ok("首页无 console error / warning", consoleIssues.length === 0, consoleIssues.join(" ;; ").slice(0, 300));

await browser.close();
}
