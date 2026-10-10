/**
 * 用真实模型跑一遍内置的合成样本，把抽取结果录进 lib/demo/recordedExtractions.json，
 * 供演示站回放。**只发送合成邮件，不碰任何真实数据。**
 *
 * 运行（在 job-command-center 目录下）：
 *
 *   export LLM_BASE_URL=https://api.deepseek.com/v1
 *   export LLM_API_KEY=...           # 只从环境变量读
 *   export LLM_MODEL=deepseek-chat
 *   npx vite-node scripts/record-extractions.ts
 *
 * 单封失败会自动重试（最多 3 次）。重试后仍有任何一封失败，就中止且不写文件——录一份残缺的结果放上演示站，
 * 比不录更糟。
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ModelExtractor, openAICompatibleComplete, toCleanEmail } from "../lib/tracker-core/index";
import type { Extraction } from "../lib/tracker-core/index";
import { buildSampleEmails } from "../lib/demo/sampleEmails";
import { tokenize } from "../lib/demo/recorded";

const apiKey = process.env.LLM_API_KEY ?? "";
const baseUrl = process.env.LLM_BASE_URL ?? "";
const model = process.env.LLM_MODEL ?? "";
if (apiKey.length === 0 || baseUrl.length === 0 || model.length === 0) {
  console.error("需要同时设置 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL 三个环境变量");
  process.exit(2);
}

/** 单封最多试几次。模型接口偶尔会超时或限流，重试一次通常就过。 */
const MAX_ATTEMPTS = 3;

const failures: string[] = [];
let lastError: string | null = null;
const extractor = new ModelExtractor({
  complete: openAICompatibleComplete({ baseUrl, apiKey, model }),
  // 录制不赶时间，给得比线上默认的 30 秒宽
  timeoutMs: 60_000,
  onError: (error) => {
    lastError = error instanceof Error ? error.message : String(error);
  },
});

const extractions: Record<string, Extraction> = {};
for (const sample of buildSampleEmails(Date.now())) {
  let extraction: Extraction | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    lastError = null;
    const result = await extractor.extract(toCleanEmail(sample.raw));
    // ModelExtractor 失败时不抛异常而是返回空抽取，所以靠 onError 有没有被调用来判断
    if (lastError === null) {
      extraction = result;
      break;
    }
    console.log(`${sample.id}: 第 ${attempt} 次失败（${lastError}）${attempt < MAX_ATTEMPTS ? "，重试" : ""}`);
  }
  if (extraction === null) {
    failures.push(`${sample.id}: ${lastError ?? "未知错误"}`);
    continue;
  }
  extractions[sample.id] = tokenize(extraction, sample.tokens);
  console.log(`${sample.id}: 公司=${extraction.companyRaw ?? "—"} 时间=${extraction.timeText ?? "—"}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 封抽取失败，未写入文件：\n${failures.join("\n")}`);
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "lib", "demo", "recordedExtractions.json");
const recording = { model, recordedOn: new Date().toISOString().slice(0, 10), extractions };
writeFileSync(target, `${JSON.stringify(recording, null, 2)}\n`, "utf8");
console.log(`\n已录制 ${Object.keys(extractions).length} 封 → lib/demo/recordedExtractions.json`);
