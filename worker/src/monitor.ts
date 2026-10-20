import { systemSender } from "./inbox.js";
import { MODEL_FAILED_PREFIX } from "./reparse.js";
import type { Env } from "./types.js";

/**
 * 收信监控：定时（wrangler.toml 的 [triggers]）检查一次，有问题就给作者发一封提醒。
 *
 * 10/13–10/15 模型连续超时三天，没人发现，直到看板上公司名认不出来——这里就是为了不再靠人眼。
 * 只查三件事，都只读最近的记录，CPU 很省（免费版定时任务每次 10 毫秒）：
 *
 * 1. AI 解析失败多（所有人合计）：过去 24 小时解析过的信里，模型失败 ≥ 2 封且占 ≥ 30%
 * 2. 收信断了（只看作者自己的）：最近一封进库已经超过 3 天（求职季里这么久一封都没有，多半是 Gmail 转发断了）
 * 3. 处理出错：过去 24 小时有信整封处理失败（status = error）
 *
 * 同一个问题 24 小时内只提醒一次（记在 settings 的 monitor 里），免得每 6 小时轰炸一次。
 */

export const WINDOW_HOURS = 24;
export const MIN_MODEL_FAILURES = 2;
export const MODEL_FAILURE_RATE = 0.3;
export const QUIET_DAYS = 3;
export const REPEAT_HOURS = 24;

export interface Problem {
  /** 去重用：同一类问题 24 小时内只提醒一次。 */
  key: "model" | "quiet" | "error";
  text: string;
}

interface Stats {
  parsed: number;
  modelFailed: number;
  errors: number;
  lastError: string | null;
  lastStoredAt: string | null;
}

async function stats(env: Env, nowMs: number): Promise<Stats> {
  const since = new Date(nowMs - WINDOW_HOURS * 3_600_000).toISOString();
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'parsed' THEN 1 ELSE 0 END) AS parsed,
       SUM(CASE WHEN status = 'parsed' AND error LIKE '${MODEL_FAILED_PREFIX}%' THEN 1 ELSE 0 END) AS model_failed,
       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
     FROM emails WHERE stored_at >= ?`,
  )
    .bind(since)
    .first<{ parsed: number | null; model_failed: number | null; errors: number | null }>();
  // 「收信断了」只看作者自己的收信（别人一段时间没信很正常）
  const last = await env.DB.prepare(
    "SELECT stored_at, error FROM emails WHERE user_id = (SELECT id FROM users WHERE role = 'owner' LIMIT 1) ORDER BY stored_at DESC LIMIT 1",
  ).first<{ stored_at: string; error: string | null }>();
  const lastFailure = await env.DB.prepare(
    `SELECT error FROM emails WHERE stored_at >= ? AND (status = 'error' OR error LIKE '${MODEL_FAILED_PREFIX}%') ORDER BY stored_at DESC LIMIT 1`,
  )
    .bind(since)
    .first<{ error: string | null }>();
  return {
    parsed: row?.parsed ?? 0,
    modelFailed: row?.model_failed ?? 0,
    errors: row?.errors ?? 0,
    lastError: lastFailure?.error ?? null,
    lastStoredAt: last?.stored_at ?? null,
  };
}

/** 现在有哪些问题。纯判断，不发信、不写库。 */
export async function findProblems(env: Env, nowMs: number): Promise<Problem[]> {
  const s = await stats(env, nowMs);
  const problems: Problem[] = [];
  if (s.modelFailed >= MIN_MODEL_FAILURES && s.parsed > 0 && s.modelFailed / s.parsed >= MODEL_FAILURE_RATE) {
    problems.push({
      key: "model",
      text: `过去 ${WINDOW_HOURS} 小时收到的 ${s.parsed} 封信里，有 ${s.modelFailed} 封 AI 没响应，只用了规则解析（公司名可能没认出）。最近一次原因：${s.lastError ?? "未知"}。处理：看板「设置 → 收信」里可以用 AI 重新解析。`,
    });
  }
  if (s.errors > 0) {
    problems.push({ key: "error", text: `过去 ${WINDOW_HOURS} 小时有 ${s.errors} 封信处理出错。最近一次原因：${s.lastError ?? "未知"}。` });
  }
  if (s.lastStoredAt !== null) {
    const days = Math.floor((nowMs - Date.parse(s.lastStoredAt)) / 86_400_000);
    if (days >= QUIET_DAYS) {
      problems.push({
        key: "quiet",
        text: `已经 ${days} 天没收到新邮件了，Gmail 转发可能断了。处理：去 Gmail「设置 → 过滤器和屏蔽的地址」看看转发过滤器还在不在，或者按看板「设置 → 收信」里的方法测一下。`,
      });
    }
  }
  return problems;
}

type Sent = Partial<Record<Problem["key"], string>>;

async function loadSent(env: Env): Promise<Sent> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'monitor'").first<{ value: string }>();
    return row ? ((JSON.parse(row.value) as { sent?: Sent }).sent ?? {}) : {};
  } catch {
    return {};
  }
}

async function saveSent(env: Env, sent: Sent, nowMs: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('monitor', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(JSON.stringify({ sent }), new Date(nowMs).toISOString())
    .run();
}

/** 发一封提醒。标题里不放「求职」「招聘」这类词，免得被 Gmail 的转发过滤器又转回收信地址。 */
export async function sendAlert(env: Env, subject: string, lines: readonly string[]): Promise<boolean> {
  const to = env.OWNER_EMAIL;
  if (!env.EMAIL || !to) return false;
  await env.EMAIL.send({
    from: { email: systemSender(env), name: "准点监控" },
    to,
    subject,
    text: [...lines, "", "（这封信由看板每 6 小时一次的自动检查发出；同一个问题 24 小时内只提醒一次。）"].join("\n"),
  });
  return true;
}

export interface MonitorResult {
  problems: Problem[];
  /** 这次真的发了提醒的问题。 */
  alerted: Problem["key"][];
}

/** 定时任务入口：查一遍，新出现的（或 24 小时前提醒过、现在还在的）问题发一封信。 */
export async function runMonitor(env: Env, nowMs: number): Promise<MonitorResult> {
  const problems = await findProblems(env, nowMs);
  if (problems.length === 0) return { problems, alerted: [] };
  const sent = await loadSent(env);
  const due = problems.filter((p) => {
    const last = sent[p.key];
    return last === undefined || nowMs - Date.parse(last) >= REPEAT_HOURS * 3_600_000;
  });
  if (due.length === 0) return { problems, alerted: [] };
  const subject = `准点提醒：${due.map((p) => ({ model: "AI 解析失败多", error: "有信处理出错", quiet: "很久没收到新邮件" })[p.key]).join("、")}`;
  const ok = await sendAlert(env, subject, due.map((p, i) => `${i + 1}. ${p.text}`));
  if (!ok) return { problems, alerted: [] };
  const stamp = new Date(nowMs).toISOString();
  for (const p of due) sent[p.key] = stamp;
  await saveSent(env, sent, nowMs);
  return { problems, alerted: due.map((p) => p.key) };
}
