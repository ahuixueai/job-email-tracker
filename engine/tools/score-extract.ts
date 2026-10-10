/**
 * 拿人工真值给解析结果打分。
 *
 * 运行（在 tracker-core 目录下，不需要 API key，不联网）：
 *
 *   npx vite-node tools/score-extract.ts ../eval/raw_sample_v2.json \
 *       ../eval/extract-v2-truth.jsonl ../eval/extract-v2-predictions.jsonl \
 *       > ../eval/extract-v2-score.md
 *
 * 两种抽取器各跑一遍完整管线再对答案：
 * - 「只用规则」：StubExtractor
 * - 「规则 + 模型」：回放 predictions 文件里录下的模型抽取结果（不重新调用模型，
 *   所以分数可复现；模型当时摘了什么就是什么）
 *
 * 打分口径的核心：**区分「答错」和「没答」。** 本产品的立场是宁可漏报不可错报，
 * 系统说「不确定」进待确认是设计内的行为，和给出一个错误时刻是两回事，不能记成同一种失败。
 *
 * ⚠️ 输入全是真实邮件，输出里带公司名，只能留在你自己的私有目录里，不要提交进公开仓库。
 */
import { readFileSync } from "node:fs";

import { parseEmail } from "../src/pipeline.js";
import type { ParseOutcome } from "../src/pipeline.js";
import { EMPTY_EXTRACTION, StubExtractor } from "../src/extract.js";
import type { Extraction, LLMExtractor } from "../src/extract.js";
import { route } from "../src/inbox.js";
import { wallClockToUtc } from "../src/timezone.js";
import type { RawEmail } from "../src/rawEmail.js";

interface SampleItem {
  date_utc?: string;
  from: string;
  subject: string;
  snippet: string;
}

interface Truth {
  id: string;
  kind: "process" | "promo" | "other";
  company: string[];
  company_unknown?: boolean;
  type: string[];
  due: "fixed" | "deadline" | "none" | "any";
  local?: string;
  tz?: string;
  tz_implicit?: boolean;
  offset?: string;
  fuzzy?: boolean;
  format?: string;
  note?: string;
}

type Verdict = "对" | "错" | "没答" | "不计";

interface Scored {
  id: string;
  kind: Truth["kind"];
  destination: string;
  company: Verdict;
  type: Verdict;
  format: Verdict;
  dueKind: Verdict;
  time: Verdict;
  detail: string[];
  /** 置信度降级理由，原样来自管线。 */
  reasons: string[];
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const fold = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/[\s·.,'’()（）-]/g, "");

function companyVerdict(truth: Truth, predicted: string): Verdict {
  const got = fold(predicted);
  if (truth.company_unknown === true) return got.length === 0 ? "对" : "错";
  if (truth.company.length === 0) return "不计";
  if (got.length === 0) return "没答";
  const hit = truth.company.some((alias) => {
    const want = fold(alias);
    return got.includes(want) || (got.length >= 2 && want.includes(got));
  });
  return hit ? "对" : "错";
}

function offsetMs(offset: string): number {
  const m = /^\+(\d+)([hd])$/.exec(offset);
  if (!m) fail(`无法解析 offset：${offset}`);
  return Number(m[1]) * (m[2] === "h" ? 3_600_000 : 86_400_000);
}

/** 真值里的确切时刻（UTC 毫秒）。没有确切时刻时为 null。 */
function expectedInstant(truth: Truth, receivedAtUtc: string): number | null {
  if (truth.fuzzy === true) return null;
  if (truth.offset !== undefined) return Date.parse(receivedAtUtc) + offsetMs(truth.offset);
  if (truth.local !== undefined && truth.tz !== undefined) {
    return Date.parse(wallClockToUtc(truth.local, truth.tz));
  }
  return null;
}

const DUE_OF: Readonly<Record<string, string>> = { fixed: "fixed_start", deadline: "deadline" };
/** 「X 日前」与「23:59」「24:00」是同一个意思的不同写法，差一分钟以内都算对。 */
const TIME_TOLERANCE_MS = 60_000;

function score(truth: Truth, outcome: ParseOutcome, receivedAtUtc: string): Scored {
  const base = { id: truth.id, kind: truth.kind };
  if (outcome.kind === "dropped") {
    const lost = truth.kind === "process";
    return {
      ...base,
      destination: "dropped",
      company: lost ? "没答" : "不计",
      type: lost ? "没答" : "不计",
      format: "不计",
      dueKind: lost ? "没答" : "不计",
      time: "不计",
      detail: lost ? [`预筛丢弃：${outcome.reason}`] : [],
      reasons: [outcome.reason],
    };
  }

  const { event, trace } = outcome;
  const destination = route(event.confidence, event.eventType, trace.confidenceReasons).destination;
  const detail: string[] = [];
  if (truth.kind !== "process") {
    return { ...base, destination, company: "不计", type: "不计", format: "不计", dueKind: "不计", time: "不计", detail, reasons: [...trace.confidenceReasons] };
  }

  const shown = trace.extraction.companyRaw ?? event.company;
  const company = companyVerdict(truth, shown);
  if (company !== "对" && company !== "不计") {
    detail.push(`公司：要「${truth.company_unknown === true ? "（认不出）" : truth.company[0]}」，得「${shown || "（空）"}」`);
  }

  const type: Verdict = truth.type.includes(event.eventType) ? "对" : event.eventType === "other" ? "没答" : "错";
  if (type !== "对") detail.push(`类型：要 ${truth.type.join("/")}，得 ${event.eventType}`);

  let format: Verdict = "不计";
  if (truth.format !== undefined) {
    const got = trace.format.format;
    format = got === truth.format ? "对" : got === "unspecified" || got === "not_applicable" ? "没答" : "错";
    if (format !== "对") detail.push(`形式：要 ${truth.format}，得 ${got}`);
  }

  let dueKind: Verdict = "不计";
  let time: Verdict = "不计";
  if (truth.due === "none") {
    // 信里没有时间：系统给出任何时刻都是无中生有
    dueKind = event.startUtc === null ? "对" : "错";
    if (dueKind === "错") detail.push(`时间：信里没有时间，系统给了 ${event.dueType} ${event.startUtc}`);
  } else if (truth.due !== "any") {
    const want = DUE_OF[truth.due] ?? "";
    if (event.dueType === want) dueKind = "对";
    else if (event.dueType === "unknown" || event.dueType === "date_only") dueKind = "没答";
    else dueKind = "错";
    if (dueKind !== "对") detail.push(`时间性质：要 ${want}，得 ${event.dueType}`);

    const expected = expectedInstant(truth, receivedAtUtc);
    if (expected !== null) {
      if (event.startUtc === null) time = "没答";
      else time = Math.abs(Date.parse(event.startUtc) - expected) <= TIME_TOLERANCE_MS ? "对" : "错";
      if (time !== "对") {
        detail.push(`时刻：要 ${new Date(expected).toISOString()}，得 ${event.startUtc ?? "（无）"}（${trace.due.reason}）`);
      }
    }
  }
  return { ...base, destination, company, type, format, dueKind, time, detail, reasons: [...trace.confidenceReasons] };
}

class ReplayExtractor implements LLMExtractor {
  constructor(private readonly byId: ReadonlyMap<string, Extraction>) {}
  extract(email: { id: string }): Promise<Extraction> {
    return Promise.resolve(this.byId.get(email.id) ?? { ...EMPTY_EXTRACTION });
  }
}

function pct(n: number, total: number): string {
  return total === 0 ? "—" : `${((n / total) * 100).toFixed(1)}%`;
}

function tallyVerdict(rows: readonly Scored[], field: "company" | "type" | "format" | "dueKind" | "time"): string {
  const counted = rows.filter((r) => r[field] !== "不计");
  const n = (v: Verdict): number => counted.filter((r) => r[field] === v).length;
  const answered = n("对") + n("错");
  return `${n("对")} 对 · ${n("错")} 错 · ${n("没答")} 没答（共 ${counted.length}）｜答了的里面对 ${pct(n("对"), answered)}，全部里面对 ${pct(n("对"), counted.length)}`;
}

const allRight = (r: Scored): boolean =>
  (["company", "type", "dueKind", "time"] as const).every((f) => r[f] === "对" || r[f] === "不计");

function report(label: string, rows: readonly Scored[]): string[] {
  const process_ = rows.filter((r) => r.kind === "process");
  const junk = rows.filter((r) => r.kind !== "process");
  const dest = (list: readonly Scored[], d: string): number => list.filter((r) => r.destination === d).length;

  const onBoard = rows.filter((r) => r.destination === "board");
  const boardRight = onBoard.filter((r) => r.kind === "process" && allRight(r));
  const boardWrong = onBoard.filter((r) => !(r.kind === "process" && allRight(r)));

  return [
    `## ${label}`,
    "",
    "### 进了日程的东西有多可信",
    "",
    `- 进入日程 ${onBoard.length} 条，其中公司、类型、时间**全部正确** ${boardRight.length} 条 → **精确率 ${pct(boardRight.length, onBoard.length)}**（目标 > 95%）`,
    `- 流程邮件共 ${process_.length} 封，全部正确且进了日程的 ${boardRight.length} 封 → **召回率 ${pct(boardRight.length, process_.length)}**（目标 > 70%）`,
    `- 进了日程但有错的 ${boardWrong.length} 条：${boardWrong.map((r) => r.id).join("、") || "无"}`,
    "",
    "### 广告与无关邮件挡住了多少",
    "",
    `- 共 ${junk.length} 封：丢弃或折叠 ${dest(junk, "dropped") + dest(junk, "noise")}，进了待确认 ${dest(junk, "pending")}，**错上日程 ${dest(junk, "board")}**`,
    "",
    `### 流程邮件逐项（${process_.length} 封）`,
    "",
    `- 去向：日程 ${dest(process_, "board")} · 待确认 ${dest(process_, "pending")} · 折叠 ${dest(process_, "noise")} · 预筛丢弃 ${dest(process_, "dropped")}`,
    `- 公司：${tallyVerdict(process_, "company")}`,
    `- 事件类型：${tallyVerdict(process_, "type")}`,
    `- 形式：${tallyVerdict(process_, "format")}`,
    `- 时间性质：${tallyVerdict(process_, "dueKind")}`,
    `- 确切时刻：${tallyVerdict(process_, "time")}`,
    "",
  ];
}

async function main(): Promise<void> {
  const [samplePath, truthPath, predPath] = process.argv.slice(2);
  if (!samplePath || !truthPath || !predPath) {
    fail("用法：npx vite-node tools/score-extract.ts <样本.json> <真值.jsonl> <预测.jsonl>");
  }
  const sample = JSON.parse(readFileSync(samplePath, "utf8")) as SampleItem[];
  const readJsonl = (path: string): Record<string, unknown>[] =>
    readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as Record<string, unknown>);

  const truths = new Map<string, Truth>();
  for (const row of readJsonl(truthPath)) {
    if (typeof row["id"] === "string") truths.set(row["id"], row as unknown as Truth);
  }
  const recorded = new Map<string, Extraction>();
  for (const row of readJsonl(predPath)) {
    const extraction = row["extraction"];
    if (typeof row["id"] === "string" && typeof extraction === "object" && extraction !== null) {
      recorded.set(row["id"], extraction as Extraction);
    }
  }

  const emails: RawEmail[] = sample.map((item, i) => ({
    id: `e${String(i).padStart(3, "0")}`,
    from: item.from,
    to: "eval@local",
    subject: item.subject,
    body: item.snippet,
    receivedAtUtc: item.date_utc && item.date_utc.length > 0 ? item.date_utc : fail(`第 ${i} 封没有 date_utc`),
  }));
  const missing = emails.filter((e) => !truths.has(e.id)).map((e) => e.id);
  if (missing.length > 0) fail(`这些邮件没有真值：${missing.join("、")}`);

  const run = async (extractor: LLMExtractor): Promise<Scored[]> => {
    const out: Scored[] = [];
    for (const email of emails) {
      const truth = truths.get(email.id);
      if (!truth) continue;
      out.push(score(truth, await parseEmail(email, { extractor }), email.receivedAtUtc));
    }
    return out;
  };
  const rule = await run(new StubExtractor());
  const model = await run(new ReplayExtractor(recorded));

  const kinds = [...truths.values()];
  const lines: string[] = [
    "# 真实邮件评测：对答案",
    "",
    `- 样本 ${emails.length} 封：流程邮件 ${kinds.filter((t) => t.kind === "process").length}，广告与岗位推荐 ${kinds.filter((t) => t.kind === "promo").length}，无关 ${kinds.filter((t) => t.kind === "other").length}`,
    "- 「没答」= 系统说不确定（没给公司名 / 没给时刻 / 类型认不出）。它和「答错」分开统计。",
    "- 精确率 = 进了日程的条目里，公司、类型、时间性质、确切时刻全对的比例。形式（电话面/视频面…）单列，不计入。",
    "",
    ...report("只用规则", rule),
    ...report("规则 + 模型", model),
    "## 规则 + 模型：每一处不对的地方",
    "",
    ...model
      .filter((r) => r.detail.length > 0)
      .map((r) => `- \`${r.id}\`（${r.destination}）${r.detail.join("；")}`),
    "",
    "## 规则 + 模型：流程邮件为什么停在待确认",
    "",
    ...model
      .filter((r) => r.kind === "process" && r.destination !== "board")
      .map((r) => `- \`${r.id}\`（${r.destination}）${r.reasons.join("；") || "（无理由）"}`),
    "",
    "## 规则 + 模型：广告与无关邮件没挡住的",
    "",
    ...model
      .filter((r) => r.kind !== "process" && (r.destination === "board" || r.destination === "pending"))
      .map((r) => `- \`${r.id}\` → ${r.destination}`),
    "",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

await main();
