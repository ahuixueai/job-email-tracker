import { ensureOwner, newInboxToken, userById } from "../src/accounts.js";
import type { User } from "../src/accounts.js";
import { putUserSetting } from "../src/store.js";
import type { UserSettingKey } from "../src/store.js";
import type { Env } from "../src/types.js";
import { testDb } from "./testDb.js";
import type { TestDb } from "./testDb.js";

/** 测试里的「作者」：登录邮箱、允许转信的 Gmail、收信域名。 */
export const ME = "me@gmail.example";
export const OWNER_EMAIL = "owner@my.example";
export const DOMAIN = "my.example";
const T0 = Date.parse("2026-10-12T00:00:00Z");

export interface Setup extends TestDb {
  e: Env;
  notices(): Record<string, unknown>[];
}

/** 一个装好迁移的空库 + 作者账号的配置。over 里的字段盖掉默认值。 */
export function setup(over: Partial<Env> = {}): Setup {
  const t = testDb();
  const e: Env = { DB: t.db, ALLOWED_FORWARDERS: ME, OWNER_EMAIL, INBOX_DOMAIN: DOMAIN, ...over };
  return { ...t, e, notices: () => t.all("SELECT * FROM notices ORDER BY rowid") };
}

export async function owner(e: Env): Promise<User> {
  const user = await ensureOwner(e, T0);
  if (user === null) throw new Error("没有作者账号");
  return user;
}

/** 造一个普通用户（不走注册流程）。 */
export async function member(e: Env, email: string, over: { forwarders?: string; ai_enabled?: number } = {}): Promise<User> {
  const id = crypto.randomUUID();
  await e.DB.prepare(
    "INSERT INTO users (id, email, role, calendar_token, inbox_token, forwarders, ai_enabled, created_at) VALUES (?, ?, 'member', ?, ?, ?, ?, ?)",
  )
    .bind(id, email, crypto.randomUUID().replace(/-/g, "").slice(0, 40).padEnd(40, "0"), newInboxToken(), over.forwarders ?? "", over.ai_enabled ?? 1, new Date(T0).toISOString())
    .run();
  const user = await userById(e, id);
  if (user === null) throw new Error("建用户失败");
  return user;
}

/** 给作者存一条设置（edits / prefs / resume）。 */
export async function ownerSetting(e: Env, key: UserSettingKey, value: string): Promise<void> {
  await putUserSetting(e, (await owner(e)).id, key, value, new Date(T0).toISOString());
}

/** 直接往库里塞一封信（只给要紧的字段，其余用占位值）。 */
export async function insertEmail(e: Env, userId: string, row: Record<string, unknown>): Promise<void> {
  const full: Record<string, unknown> = {
    id: crypto.randomUUID(),
    user_id: userId,
    message_id: null,
    received_at: "2026-10-10T00:00:00.000Z",
    stored_at: "2026-10-10T00:00:00.000Z",
    via: "auto",
    from_addr: "hr@x.example",
    subject: "s",
    body: "",
    status: "parsed",
    outcome: null,
    model: null,
    error: null,
    ...row,
  };
  const cols = Object.keys(full);
  await e.DB.prepare(`INSERT INTO emails (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .bind(...Object.values(full))
    .run();
}
