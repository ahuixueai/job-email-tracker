/**
 * 验收跑批。每轮改动后跑一次：npm run e2e
 * 需要先起 dev server（npm run dev），或用 JCC_URL 指向别的地址。
 */
const URL = process.env.JCC_URL ?? "http://localhost:3000";

const SUITES = [
  ["持久化（新建→刷新→编辑→刷新→删除→刷新）", "./persistence.mjs"],
  ["台账持续同步（改了/关了之后卡片跟不跟着变）", "./ledgerSync.mjs"],
  ["手势（拖拽排序与左右滑动互不串扰）", "./gestures.mjs"],
  ["时区 cookie 与 SSR 降级", "./timezone.mjs"],
  ["数据精度（date/未确认时区不画编造的钟点）", "./dataPrecision.mjs"],
  ["减少动态效果", "./reduced-motion.mjs"],
  ["配色对比度（WCAG AA）", "./contrast.mjs"],
];

let total = 0;
let failed = 0;

function makeReporter(suite) {
  return (name, pass, detail = "") => {
    total += 1;
    if (!pass) failed += 1;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`,
    );
    if (!pass) process.exitCode = 1;
    void suite;
  };
}

const res = await fetch(URL).catch(() => null);
if (!res || !res.ok) {
  console.error(`跑不了：${URL} 没有响应。先执行 npm run dev。`);
  process.exit(1);
}

for (const [label, path] of SUITES) {
  console.log(`\n=== ${label} ===`);
  const mod = await import(path);
  try {
    await mod.run(makeReporter(label));
  } catch (error) {
    failed += 1;
    total += 1;
    console.log(`  FAIL  套件本身抛错  [${error.message}]`);
    process.exitCode = 1;
  }
}

console.log(
  `\n${total - failed}/${total} 通过${failed ? `，${failed} 项失败` : ""}`,
);
process.exit(failed ? 1 : 0);
