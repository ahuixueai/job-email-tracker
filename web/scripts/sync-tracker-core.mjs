#!/usr/bin/env node
/**
 * 把 ../engine/src 的解析引擎源码同步进 lib/tracker-core/。
 *
 * 为什么是拷贝而不是 npm 依赖：引擎的 src/ 是零依赖的纯 TypeScript，
 * 拷进来最简单，也让网页的部署根目录可以只选 web/ 这一个文件夹。
 *
 * **lib/tracker-core/ 是生成物，不要手改**——改动一律在 engine/ 里做，
 * 跑完那边的测试再同步过来：
 *
 *   node scripts/sync-tracker-core.mjs
 *
 * 只同步 src/。测试和工具不带。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "engine", "src");
const to = join(here, "..", "lib", "tracker-core");

const BANNER =
  "// 生成物：由 scripts/sync-tracker-core.mjs 从 engine/src 同步而来，不要手改。\n";

/**
 * `--check`：只比对、不写入。生成物和引擎源码对不上就退出码 1——
 * CI 用它拦住「改了引擎却忘了同步到网页」，否则演示站会悄悄跑着旧引擎。
 */
const checkOnly = process.argv.includes("--check");

const files = readdirSync(from).filter((name) => name.endsWith(".ts"));
if (files.length === 0) {
  console.error(`在 ${from} 下没找到任何 .ts 文件，同步中止`);
  process.exit(1);
}
const render = (name) =>
  // 引擎按 ESM 规范写 `from "./x.js"`，Turbopack 不会把它解析回 `x.ts`，
  // 所以同步时去掉后缀。只动相对路径的 import/export 说明符，别的一字不改。
  BANNER + readFileSync(join(from, name), "utf8").replace(/(\bfrom\s+"\.{1,2}\/[^"]+)\.js"/g, '$1"');

if (checkOnly) {
  const stale = files.filter((name) => {
    try {
      return readFileSync(join(to, name), "utf8") !== render(name);
    } catch {
      return true;
    }
  });
  const extra = readdirSync(to).filter((name) => name.endsWith(".ts") && !files.includes(name));
  if (stale.length > 0 || extra.length > 0) {
    console.error(`lib/tracker-core/ 与 engine/src 不一致：${[...stale, ...extra].join("、")}`);
    console.error("在 web/ 下运行 node scripts/sync-tracker-core.mjs 后再提交。");
    process.exit(1);
  }
  console.log(`lib/tracker-core/ 与 engine/src 一致（${files.length} 个文件）`);
  process.exit(0);
}

mkdirSync(to, { recursive: true });
for (const name of files) writeFileSync(join(to, name), render(name), "utf8");
console.log(`已同步 ${files.length} 个文件 → lib/tracker-core/`);
