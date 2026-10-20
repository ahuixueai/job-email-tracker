import type { User } from "./accounts.js";
import type { Env } from "./types.js";

/**
 * 对用户负责的两件事（隐私政策第 2、4 节写了，这里兑现）：
 *
 * 1. 删除我的账号和全部数据：立即删掉这个人的所有行（别人的不动）。
 * 2. 定期清理：登录用的 IP 记录 2 天后删；验证码那张表一天没动过的行删掉
 *    （里面有别人尝试登录时填的邮箱，不该长期留着）。由定时任务调用。
 */

/** 用户要手打这句话，才执行删除。 */
export const DELETE_CONFIRM_TEXT = "删除全部数据";

export async function deleteUserData(env: Env, user: User): Promise<void> {
  for (const table of ["emails", "notices", "user_settings", "ai_usage", "reminders_sent"] as const) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(user.id).run();
  }
  await env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(user.email).run();
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
}

export const IP_LOG_DAYS = 2;
export const CODE_ROW_DAYS = 1;

export async function pruneSecurityLogs(env: Env, nowMs: number): Promise<void> {
  const ipCutoff = new Date(nowMs - IP_LOG_DAYS * 86_400_000).toISOString();
  const codeCutoff = new Date(nowMs - CODE_ROW_DAYS * 86_400_000).toISOString();
  await env.DB.prepare("DELETE FROM login_sends WHERE at < ?").bind(ipCutoff).run();
  await env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(ipCutoff).run();
  await env.DB.prepare("DELETE FROM login_codes WHERE last_sent_at < ?").bind(codeCutoff).run();
}
