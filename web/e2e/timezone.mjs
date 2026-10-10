import { chromium } from "playwright";

const URL = process.env.JCC_URL ?? "http://localhost:3000";

export async function run(check) {
// ---- SSR 层：直接看服务端吐出的 HTML ----
// ?seed=demo：这几条断言测的是「有面试数据时双时区列渲不渲染」，
// 生产默认路径不再自带 mock（见 store/useInterviewStore.ts），
// 所以这里显式要固定演示数据，不依赖真实 ledger.db 里有没有东西。
const html = async (cookie) => {
  const res = await fetch(`${URL}/board?seed=demo`, cookie ? { headers: { cookie } } : undefined);
  return { status: res.status, body: await res.text() };
};

const first = await html(null);
check("首访（无 cookie）SSR 不渲染右列，维持降级", first.status === 200 && !first.body.includes("你所在地"));

const returning = await html("jcc_tz=America%2FLos_Angeles");
check("回访（cookie=America/Los_Angeles）SSR 直接渲染右列", returning.status === 200 && returning.body.includes("你所在地"));

const sameZone = await html("jcc_tz=America%2FNew_York");
check("cookie 与某场面试同区时 SSR 输出「与你所在时区相同」", sameZone.body.includes("与你所在时区相同"));

const bogus = await html("jcc_tz=Not%2FAZone");
check("伪造时区 cookie 不使 SSR 崩溃，降级为首访", bogus.status === 200 && !bogus.body.includes("你所在地"), `status=${bogus.status}`);

const injected = await html(`jcc_tz=${encodeURIComponent("<script>alert(1)</script>")}`);
check("注入型 cookie 被拒绝且不进入 HTML", injected.status === 200 && !injected.body.includes("alert(1)"), `status=${injected.status}`);

const longCookie = await html(`jcc_tz=${"A".repeat(200)}`);
check("超长 cookie 被拒绝", longCookie.status === 200);

// ---- 浏览器层：写入与无抖动 ----
const browser = await chromium.launch();

// 1) 首次访问：应写入 cookie
const ctx1 = await browser.newContext({ viewport: { width: 900, height: 1000 }, timezoneId: "Asia/Tokyo" });
const p1 = await ctx1.newPage();
const errs1 = [];
p1.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs1.push(m.text()); });
p1.on("pageerror", (e) => errs1.push(e.message));
await p1.goto(`${URL}/board?seed=demo`, { waitUntil: "networkidle" });
await p1.waitForTimeout(400);
const cookies1 = await ctx1.cookies();
const tz = cookies1.find((c) => c.name === "jcc_tz");
check("首访后客户端写入 jcc_tz cookie", tz?.value === "Asia%2FTokyo" || decodeURIComponent(tz?.value ?? "") === "Asia/Tokyo", tz ? decodeURIComponent(tz.value) : "缺失");
check("cookie 属性正确（path=/ , SameSite=Lax, 一年）", tz?.path === "/" && /lax/i.test(tz?.sameSite ?? "") && tz.expires > Date.now() / 1000 + 60 * 60 * 24 * 300, `path=${tz?.path} sameSite=${tz?.sameSite}`);
check("首访无 hydration 报错", errs1.length === 0, errs1.join(";").slice(0, 200));

// 2) 同一 context 二次访问：SSR 首屏就该是双列，不抖
const p2 = await ctx1.newPage();
const errs2 = [];
p2.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs2.push(m.text()); });
p2.on("pageerror", (e) => errs2.push(e.message));
// 关掉 JS，只看服务端首屏
const ctxNoJs = await browser.newContext({ viewport: { width: 900, height: 1000 }, javaScriptEnabled: false, timezoneId: "Asia/Tokyo" });
await ctxNoJs.addCookies([{ name: "jcc_tz", value: "Asia%2FTokyo", domain: "localhost", path: "/" }]);
const pNoJs = await ctxNoJs.newPage();
await pNoJs.goto(`${URL}/board?seed=demo`, { waitUntil: "domcontentloaded" });
const colsNoJs = await pNoJs.$$eval("li", (lis) => lis.map((l) => l.innerText.includes("你所在地")));
check("禁用 JS + 携带 cookie：首屏已是双列（证明无 hydration 后补列）", colsNoJs.every(Boolean), JSON.stringify(colsNoJs));

await p2.goto(`${URL}/board?seed=demo`, { waitUntil: "networkidle" });
await p2.waitForTimeout(400);
check("回访无 hydration 报错", errs2.length === 0, errs2.join(";").slice(0, 200));

await browser.close();
}
