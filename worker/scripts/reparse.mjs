#!/usr/bin/env node
/**
 * 引擎规则改进后，把已经收到的邮件按新规则重判一遍（不再调用模型，回放收信时模型摘下的内容，不花钱）。
 *
 * 用法：npm run reparse
 * 登录用看板密码（终端里输入，不显示、不保存）。可以随时中断后重跑。
 */
import readline from "node:readline";

const BASE = process.env.BOARD_URL ?? "https://board.interviewtrack.me";

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
  login = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
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

let after = null;
let checked = 0;
let changed = 0;
for (;;) {
  const res = await fetch(`${BASE}/api/reparse`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(after === null ? {} : { after }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`重判失败：${body.error ?? res.status}（已处理 ${checked} 封，重跑即可接着做）`);
    process.exit(1);
  }
  checked += body.checked;
  changed += body.changed;
  process.stdout.write(`\r已重判 ${checked} 封，其中结论变了 ${changed} 封`);
  if (body.next === null) break;
  after = body.next;
}
console.log(`\n完成。打开 ${BASE} 点「刷新」查看。`);
