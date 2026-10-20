import type { User } from "./accounts.js";
import type { Env } from "./types.js";

/**
 * 每个人用不用 AI、今天还能用几次。
 *
 * - 开关：有人不愿意把邮件交给 AI 服务商（DeepSeek，在中国境内处理），可以在设置里关掉，只用规则。
 * - 额度：摘信息、一句话添加、面试准备，每调用一次模型记一次；每人每天上限 AI_DAILY_LIMIT（默认 100），
 *   免得一个人（或一个被刷的账号）把费用拖上去。作者账号不限。
 * - 关掉或用完时照样处理：退回纯规则，并在记录里写明原因（不算「模型调用失败」，监控不报警、也不进重试）。
 */

export const DEFAULT_AI_DAILY_LIMIT = 100;
export const AI_OFF_NOTE = "你关掉了 AI，只用规则解析";
export const AI_QUOTA_NOTE = "今天的 AI 额度用完了，只用规则解析";

export function aiDailyLimit(env: Env): number {
  const n = Number(env.AI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_AI_DAILY_LIMIT;
}

function day(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export async function aiUsageToday(env: Env, userId: string, nowMs: number): Promise<number> {
  const row = await env.DB.prepare("SELECT calls FROM ai_usage WHERE user_id = ? AND day = ?").bind(userId, day(nowMs)).first<{ calls: number }>();
  return row?.calls ?? 0;
}

export type AiGate = { ok: true } | { ok: false; note: string };

/** 这一次能不能用 AI。能用就顺手记一次（调用方随后一定会调模型）。 */
export async function takeAiCall(env: Env, user: User, nowMs: number): Promise<AiGate> {
  if (user.ai_enabled === 0) return { ok: false, note: AI_OFF_NOTE };
  if (user.role !== "owner" && (await aiUsageToday(env, user.id, nowMs)) >= aiDailyLimit(env)) return { ok: false, note: AI_QUOTA_NOTE };
  await env.DB.prepare(
    "INSERT INTO ai_usage (user_id, day, calls) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET calls = calls + 1",
  )
    .bind(user.id, day(nowMs))
    .run();
  return { ok: true };
}
