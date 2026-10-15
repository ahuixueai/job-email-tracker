#!/usr/bin/env node
/**
 * 把 Gmail 里的旧求职邮件导入私人看板。
 *
 * 输入：scripts/gmail_scan.py scan 的输出（JSON 数组，每项有 from / subject / snippet / date_utc）。
 * 做法：用看板密码登录（在终端里输入，不显示、不保存），然后一封一封交给 /api/import，
 *       和收信走同一条解析路（规则 + 模型），收信时刻用原信的时间。
 *
 * 用法：
 *   node scripts/import-gmail.mjs /tmp/jobs-import.json
 *   node scripts/import-gmail.mjs /tmp/jobs-import.json --dry-run    只数一数，不导入
 *
 * 同一份文件跑两遍不会重复入库（按 发件人 + 原信时刻 + 主题 去重）。
 */
import { readFileSync } from "node:fs";
import readline from "node:readline";

const BASE = process.env.BOARD_URL ?? "https://board.interviewtrack.me";
const CONCURRENCY = 3;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
if (!file) {
  console.error("用法：node scripts/import-gmail.mjs <gmail_scan 导出的 JSON 文件> [--dry-run]");
  process.exit(1);
}

let rows;
try {
  rows = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`读不了 ${file}：${error.message}`);
  process.exit(1);
}
if (!Array.isArray(rows)) {
  console.error("文件内容应该是一个 JSON 数组（gmail_scan.py scan 的输出）");
  process.exit(1);
}

const items = [];
const noDate = [];
for (const row of rows) {
  const item = {
    from: String(row.from ?? ""),
    subject: String(row.subject ?? ""),
    body: String(row.snippet ?? row.body ?? ""),
    receivedAtUtc: String(row.date_utc ?? ""),
  };
  if (item.receivedAtUtc.length === 0) noDate.push(item);
  else items.push(item);
}
// 从旧到新导入：看板按时间合并同一件事，顺序和真实收信一致最稳
items.sort((a, b) => a.receivedAtUtc.localeCompare(b.receivedAtUtc));

console.log(`共 ${rows.length} 封：可导入 ${items.length} 封，缺发信时刻跳过 ${noDate.length} 封`);
for (const item of noDate) console.log(`  跳过（没有时区的 Date 头）：${item.subject}`);
if (dryRun || items.length === 0) process.exit(0);

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.includes(question)) rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const password = await askHidden("看板密码（输入不显示）：");
let login;
try {
  login = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
} catch (error) {
  console.error(`连不上 ${BASE}：${error.cause?.code ?? error.message}`);
  process.exit(1);
}
if (!login.ok) {
  const body = await login.json().catch(() => ({}));
  console.error(`登录失败：${body.error ?? login.status}`);
  process.exit(1);
}
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

const counts = { parsed: 0, dropped: 0, self: 0, error: 0, duplicate: 0, invalid: 0, failed: 0 };
const LABEL = { parsed: "已解析", dropped: "非求职，已忽略", self: "你自己发的", error: "解析出错", duplicate: "之前导入过", invalid: "数据不全", failed: "请求失败" };
let done = 0;

async function importOne(item) {
  let outcome;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/import`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(item),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        console.error("登录过期了，重新运行即可（已导入的不会重复）");
        process.exit(1);
      }
      if (res.status === 400) outcome = "invalid";
      else if (res.ok) outcome = body.kind === "duplicate" ? "duplicate" : body.status;
      else throw new Error(body.error ?? `HTTP ${res.status}`);
      break;
    } catch (error) {
      if (attempt === 3) {
        outcome = "failed";
        console.error(`  ${item.subject}：${error.message}`);
      } else await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  counts[outcome] = (counts[outcome] ?? 0) + 1;
  done += 1;
  console.log(`${String(done).padStart(4)}/${items.length}  ${LABEL[outcome] ?? outcome}  ${item.receivedAtUtc.slice(0, 10)}  ${item.subject.slice(0, 50)}`);
}

const queue = [...items];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) await importOne(queue.shift());
  }),
);

console.log("\n完成：" + Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${LABEL[k]} ${n}`).join("，"));
console.log(`打开 ${BASE} 点「刷新」查看。`);
