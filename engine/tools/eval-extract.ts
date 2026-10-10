/**
 * 抽取层评测：同一批邮件分别用 StubExtractor 与真实模型跑一遍完整管线，
 * 输出对比报告，并把逐封结果写成 JSONL 供人工标注真值。
 *
 * 运行（在 tracker-core 目录下）：
 *
 *   export LLM_BASE_URL=https://api.deepseek.com/v1
 *   export LLM_API_KEY=...            # 只从环境变量读，不接受命令行参数
 *   export LLM_MODEL=deepseek-chat
 *   npx vite-node tools/eval-extract.ts ../eval/raw_sample_v2.json \
 *       --out ../eval/extract-v2-predictions.jsonl > ../eval/extract-v2-report.md
 *
 * 不设 LLM_API_KEY 时只跑桩，用来先确认样本文件读得进来。
 *
 * ⚠️ 输入与 --out 输出都含真实邮件内容，只能留在你自己的私有目录里，不要提交进公开仓库。
 *
 * 输入是 `scripts/gmail_scan.py scan` 的 JSON。收信时刻取 `date_utc` 字段；
 * 旧样本没有这个字段时必须显式给 `--legacy-offset +08:00`——不按发件人猜时区，
 * 那正是铁律二禁止的事。
 */
import { readFileSync, writeFileSync } from "node:fs";

import { parseEmail } from "../src/pipeline.js";
import type { ParseOutcome } from "../src/pipeline.js";
import { StubExtractor } from "../src/extract.js";
import type { LLMExtractor } from "../src/extract.js";
import { ModelExtractor, openAICompatibleComplete } from "../src/llmExtractor.js";
import type { ChatComplete } from "../src/llmExtractor.js";
import { route } from "../src/inbox.js";
import type { RawEmail } from "../src/rawEmail.js";

interface SampleItem {
  date: string;
  date_utc?: string;
  from: string;
  subject: string;
  snippet: string;
  folder?: string;
}

interface Row {
  id: string;
  company: string;
  companyMatched: boolean;
  eventType: string;
  dueType: string;
  startUtc: string | null;
  sourceTimeZone: string | null;
  confidence: string;
  destination: string;
}

const CONCURRENCY = 4;
/** 单封最多调用模型几次。接口偶发超时或限流，不重试的话这些会被记成「模型失败」，把评测数字拉低。 */
const MAX_ATTEMPTS = 3;
/** 单次调用的等待上限。 */
const ATTEMPT_TIMEOUT_MS = 60_000;

/** 给一次模型调用加上「单次超时 + 失败重试」。重试次数用尽才把错误抛出去。 */
function withRetry(complete: ChatComplete, onRetry: () => void): ChatComplete {
  return async (prompt) => {
    let lastError: unknown = new Error("未调用");
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          complete(prompt),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`单次调用超时（${ATTEMPT_TIMEOUT_MS}ms）`)), ATTEMPT_TIMEOUT_MS);
          }),
        ]);
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) onRetry();
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    throw lastError;
  };
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function argValue(args: readonly string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] ?? fail(`${name} 后面缺参数值`);
}

function receivedAt(item: SampleItem, legacyOffset: string | null, index: number): string {
  if (typeof item.date_utc === "string" && item.date_utc.length > 0) return item.date_utc;
  if (legacyOffset === null) {
    fail(
      `第 ${index} 封没有 date_utc 字段。用新版 gmail_scan.py 重新导出，` +
        "或显式指定 --legacy-offset（如 +08:00）说明 date 字段是哪个偏移量下的本地时间。",
    );
  }
  const iso = new Date(`${item.date.replace(" ", "T")}:00${legacyOffset}`);
  if (Number.isNaN(iso.getTime())) fail(`第 ${index} 封的 date 无法解析：${item.date}`);
  return iso.toISOString();
}

function toRow(outcome: ParseOutcome): Row | null {
  if (outcome.kind === "dropped") return null;
  const e = outcome.event;
  return {
    id: outcome.emailId,
    company: e.company,
    companyMatched: e.companyMatched,
    eventType: e.eventType,
    dueType: e.dueType,
    startUtc: e.startUtc,
    sourceTimeZone: e.sourceTimeZone,
    confidence: e.confidence,
    destination: route(e.confidence, e.eventType, outcome.trace.confidenceReasons).destination,
  };
}

async function runAll(
  emails: readonly RawEmail[],
  extractor: LLMExtractor,
  onDone?: (done: number) => void,
): Promise<ParseOutcome[]> {
  const results = new Array<ParseOutcome>(emails.length);
  let next = 0;
  let finished = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      const email = emails[i];
      if (email === undefined) return;
      results[i] = await parseEmail(email, { extractor });
      finished += 1;
      onDone?.(finished);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return results;
}

function tally<T>(items: readonly T[], key: (item: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
}

function pct(n: number, total: number): string {
  return total === 0 ? "—" : `${((n / total) * 100).toFixed(1)}%`;
}

function summarize(label: string, rows: readonly Row[], parsedTotal: number): string[] {
  const withCompany = rows.filter((r) => r.company.length > 0).length;
  const matched = rows.filter((r) => r.companyMatched).length;
  const withTime = rows.filter((r) => r.startUtc !== null).length;
  const withZone = rows.filter((r) => r.sourceTimeZone !== null).length;
  return [
    `### ${label}`,
    "",
    `| 指标 | 值 |`,
    `|---|---|`,
    `| 抽出公司名 | ${withCompany} / ${parsedTotal}（${pct(withCompany, parsedTotal)}） |`,
    `| 公司名命中别名表 | ${matched} / ${parsedTotal}（${pct(matched, parsedTotal)}） |`,
    `| 解析出时刻 | ${withTime} / ${parsedTotal}（${pct(withTime, parsedTotal)}） |`,
    `| 推断出时区 | ${withZone} / ${parsedTotal}（${pct(withZone, parsedTotal)}） |`,
    `| 去向 | ${tally(rows, (r) => r.destination)} |`,
    `| 事件类型 | ${tally(rows, (r) => r.eventType)} |`,
    `| 时间语义 | ${tally(rows, (r) => r.dueType)} |`,
    "",
  ];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const samplePath = args.find((a) => !a.startsWith("--") && a !== argValue(args, "--out") && a !== argValue(args, "--legacy-offset"));
  if (samplePath === undefined) fail("用法：npx vite-node tools/eval-extract.ts <样本.json> [--out 预测.jsonl] [--legacy-offset +08:00]");
  const outPath = argValue(args, "--out");
  const legacyOffset = argValue(args, "--legacy-offset");
  if (legacyOffset !== null && !/^[+-]\d{2}:\d{2}$/.test(legacyOffset)) {
    fail(`--legacy-offset 需要形如 +08:00，收到 ${legacyOffset}`);
  }

  const sample = JSON.parse(readFileSync(samplePath, "utf8")) as SampleItem[];
  const emails: RawEmail[] = sample.map((item, i) => ({
    id: `e${String(i).padStart(3, "0")}`,
    from: item.from,
    to: "eval@local",
    subject: item.subject,
    body: item.snippet,
    receivedAtUtc: receivedAt(item, legacyOffset, i),
  }));

  const stubOutcomes = await runAll(emails, new StubExtractor());

  const apiKey = process.env["LLM_API_KEY"] ?? "";
  const baseUrl = process.env["LLM_BASE_URL"] ?? "";
  const model = process.env["LLM_MODEL"] ?? "";
  let modelOutcomes: ParseOutcome[] | null = null;
  let errors = 0;
  let calls = 0;
  let totalMs = 0;
  let ungrounded = 0;
  let retries = 0;
  /** 失败原因 → 次数。报错信息只含状态码之类，不含密钥与邮件内容。 */
  const errorReasons = new Map<string, number>();

  if (apiKey.length > 0) {
    if (baseUrl.length === 0 || model.length === 0) fail("设了 LLM_API_KEY 就必须同时设 LLM_BASE_URL 与 LLM_MODEL");
    const inner = withRetry(openAICompatibleComplete({ baseUrl, apiKey, model }), () => {
      retries += 1;
    });
    const timed: ChatComplete = async (prompt) => {
      const started = Date.now();
      calls += 1;
      try {
        return await inner(prompt);
      } finally {
        totalMs += Date.now() - started;
      }
    };
    // 统计「模型给了片段、但片段不在原文里」的次数：这是幻觉率的直接度量。
    const counting: ChatComplete = async (prompt) => {
      const reply = await timed(prompt);
      try {
        const raw = JSON.parse(reply) as Record<string, unknown>;
        const source = prompt.user.replace(/\s+/g, "").toLowerCase();
        for (const field of ["timeText", "locationRaw"]) {
          const value = raw[field];
          if (typeof value === "string" && value.trim().length > 0) {
            if (!source.includes(value.replace(/\s+/g, "").toLowerCase())) ungrounded += 1;
          }
        }
      } catch {
        // 解析不了的回复由 ModelExtractor 统计进 errors
      }
      return reply;
    };
    modelOutcomes = await runAll(
      emails,
      new ModelExtractor({
        complete: counting,
        // 重试与单次超时已经在 withRetry 里管了，这里只留一个兜底的总上限
        timeoutMs: MAX_ATTEMPTS * ATTEMPT_TIMEOUT_MS + 5_000,
        onError: (error) => {
          errors += 1;
          const reason = error instanceof Error ? error.message : String(error);
          errorReasons.set(reason, (errorReasons.get(reason) ?? 0) + 1);
        },
      }),
      (done) => {
        // 进度写到 stderr：stdout 被重定向进报告文件，不写这里的话终端会一片空白十几分钟
        if (done % 10 === 0 || done === emails.length) {
          process.stderr.write(`已处理 ${done}/${emails.length} 封，模型失败 ${errors} 封\n`);
        }
        // 开头一批全军覆没说明是配置或额度问题，不是偶发：立刻停下来报原因，别再空跑十几分钟
        if (done >= 8 && errors >= done) {
          const top = [...errorReasons.entries()].sort((a, b) => b[1] - a[1])[0];
          fail(
            `\n前 ${done} 封的模型调用全部失败，已中止。最常见的原因：${top?.[0] ?? "未知"}\n` +
              "没有写入任何结果文件。",
          );
        }
      },
    );
  }

  const stubRows = stubOutcomes.map(toRow).filter((r): r is Row => r !== null);
  const dropped = stubOutcomes.length - stubRows.length;
  const lines: string[] = [
    "# 抽取层评测报告",
    "",
    `- 样本：${emails.length} 封（预筛丢弃 ${dropped} 封，进入解析 ${stubRows.length} 封）`,
    `- 模型：${modelOutcomes === null ? "未运行（没有设 LLM_API_KEY）" : model}`,
    "",
    "> 本报告只统计**覆盖率与两种抽取器之间的差异**，不是准确率。",
    "> 准确率要拿人工真值比，见报告末尾的「待人工核对」。",
    "",
    ...summarize("桩抽取器（标题正则）", stubRows, stubRows.length),
  ];

  if (modelOutcomes !== null) {
    const modelRows = modelOutcomes.map(toRow).filter((r): r is Row => r !== null);
    lines.push(...summarize(`真实模型（${model}）`, modelRows, modelRows.length));
    lines.push(
      "### 模型调用",
      "",
      `| 指标 | 值 |`,
      `|---|---|`,
      `| 邮件数 | ${calls} |`,
      `| 中途重试次数 | ${retries} |`,
      `| 重试后仍失败（超时/HTTP 错误/非 JSON） | ${errors}（${pct(errors, calls)}） |`,
      `| 平均耗时（含重试） | ${calls === 0 ? "—" : `${Math.round(totalMs / calls)} ms`} |`,
      `| 未接地片段（被接地检查丢弃） | ${ungrounded} |`,
      "",
    );
    if (errorReasons.size > 0) {
      lines.push(
        "失败原因：",
        "",
        ...[...errorReasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `- ${n} 次：${reason}`),
        "",
      );
    }

    const byId = new Map(stubRows.map((r) => [r.id, r]));
    const diffs: string[] = [];
    for (const m of modelRows) {
      const s = byId.get(m.id);
      if (s === undefined) continue;
      const changed: string[] = [];
      if (s.startUtc !== m.startUtc) changed.push(`时刻 ${s.startUtc ?? "无"} → ${m.startUtc ?? "无"}`);
      if (s.dueType !== m.dueType) changed.push(`语义 ${s.dueType} → ${m.dueType}`);
      if (s.eventType !== m.eventType) changed.push(`类型 ${s.eventType} → ${m.eventType}`);
      if (s.destination !== m.destination) changed.push(`去向 ${s.destination} → ${m.destination}`);
      if (changed.length > 0) diffs.push(`- \`${m.id}\` ${m.company || "（无公司名）"}：${changed.join("；")}`);
    }
    lines.push(
      `### 待人工核对：两种抽取器结论不同的 ${diffs.length} 封`,
      "",
      "这些是模型圈出的时间片段改变了规则结论的地方，每一条都要回原文确认谁对。",
      "",
      ...diffs,
      "",
    );

    if (outPath !== null) {
      const jsonl = modelOutcomes
        .map((outcome, i) => {
          const item = sample[i];
          const base = { id: outcome.emailId, subject: item?.subject ?? "", from: item?.from ?? "" };
          if (outcome.kind === "dropped") return JSON.stringify({ ...base, dropped: outcome.reason });
          return JSON.stringify({
            ...base,
            pred: toRow(outcome),
            extraction: outcome.trace.extraction,
            truth: null,
          });
        })
        .join("\n");
      writeFileSync(outPath, `${jsonl}\n`, "utf8");
      lines.push(`逐封结果已写入 \`${outPath}\`，\`truth\` 字段留空待标注。`, "");
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

await main();
