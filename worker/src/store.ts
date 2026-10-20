import { parsePrefs } from "../../web/lib/demo/boardPrefs";
import type { BoardPrefs } from "../../web/lib/demo/boardPrefs";
import type { Env } from "./types.js";

/**
 * 每个人自己的设置：edits（看板上的手动操作）、prefs（偏好）、resume（简历文字）。
 * 存在 user_settings 表里，按 (user_id, key) 分开。系统自己的（monitor）还在 settings 表。
 */
export type UserSettingKey = "edits" | "prefs" | "resume";

export async function getUserSetting(env: Env, userId: string, key: UserSettingKey): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = ?").bind(userId, key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function putUserSetting(env: Env, userId: string, key: UserSettingKey, value: string, updatedAt: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(userId, key, value, updatedAt)
    .run();
}

export async function deleteUserSetting(env: Env, userId: string, key: UserSettingKey): Promise<void> {
  await env.DB.prepare("DELETE FROM user_settings WHERE user_id = ? AND key = ?").bind(userId, key).run();
}

function safeJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 偏好；没存过或坏了就用默认值。 */
export async function loadPrefs(env: Env, userId: string): Promise<BoardPrefs> {
  return parsePrefs(safeJson(await getUserSetting(env, userId, "prefs")));
}

/** 看板操作（原样的 JSON）；没有为 null。 */
export async function loadEditsJson(env: Env, userId: string): Promise<unknown> {
  return safeJson(await getUserSetting(env, userId, "edits"));
}

/**
 * 这个人确认过的「公司 → 时区」。收信时当作时区线索。
 * 读不到、读坏了都返回空表——宁可不用这条线索，也不能让收信因此失败。
 */
export async function loadCompanyZones(env: Env, userId: string): Promise<Record<string, string>> {
  try {
    const edits = (await loadEditsJson(env, userId)) as { companyZones?: unknown } | null;
    const zones = edits?.companyZones;
    if (typeof zones !== "object" || zones === null) return {};
    const out: Record<string, string> = {};
    for (const [company, zone] of Object.entries(zones)) {
      if (typeof zone === "string" && zone.includes("/")) out[company] = zone;
    }
    return out;
  } catch {
    return {};
  }
}

/** 这个人标成「广告」的发件地址（小写）。读不到返回空表——宁可多收一封广告，也不能让收信失败。 */
export async function loadBlockedSenders(env: Env, userId: string): Promise<string[]> {
  try {
    const edits = (await loadEditsJson(env, userId)) as { blockedSenders?: unknown } | null;
    const list = edits?.blockedSenders;
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string").map((s) => s.toLowerCase()) : [];
  } catch {
    return [];
  }
}
