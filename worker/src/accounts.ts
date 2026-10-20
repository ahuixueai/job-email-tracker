import { codeHash, sameString, signingSecret } from "./auth.js";
import { calendarToken } from "./calendar.js";
import type { Env } from "./types.js";

/**
 * 账号与邮箱验证码登录。
 *
 * - 第 2 期起开放注册：任何邮箱都能要验证码，验证通过才建账号（证明邮箱是你的）；
 *   名额上限 MAX_USERS（默认 50），满了新邮箱拿不到码；REGISTRATION = "closed" 可以随时关掉注册
 * - 作者账号（OWNER_EMAIL）另有密码备用登录
 * - 验证码 6 位、10 分钟有效、最多试 5 次；同一邮箱 60 秒内不能重发、一小时最多 5 次；同一来源一小时最多发 20 次
 * - 不在名单里的邮箱：照样回答「已发送」、照样受频率限制，只是不真发——外人试不出谁有账号
 * - 发码、密码登录之前都要先过 Cloudflare Turnstile（防机器人）
 */

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_CODE_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const MAX_SENDS_PER_EMAIL_HOUR = 5;
export const MAX_SENDS_PER_IP_HOUR = 20;
const HOUR = 3_600_000;

export interface User {
  id: string;
  email: string;
  role: string;
  calendar_token: string | null;
  /** 收信地址里的口令：u-<inbox_token>@域名。 */
  inbox_token: string | null;
  /** 除登录邮箱外，还允许哪些邮箱转信进来（逗号分隔）。 */
  forwarders: string;
  /** 1 = 用 AI 摘信息；0 = 只用规则。 */
  ai_enabled: number;
}

const USER_COLUMNS = "id, email, role, calendar_token, inbox_token, forwarders, ai_enabled";

export const DEFAULT_MAX_USERS = 50;
export const MAX_EXTRA_FORWARDERS = 3;
const ALL_LEGACY_KEYS = "('edits', 'prefs', 'resume')";

/** 收信地址口令：10 位小写字母数字，猜不出来（真正挡陌生人的是「只收你自己的邮箱转来的」）。 */
export function newInboxToken(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => alphabet[b % alphabet.length]).join("");
}

/** 收信地址所在的域名。 */
export function inboxDomain(env: Env): string {
  return env.INBOX_DOMAIN && env.INBOX_DOMAIN.includes(".") ? env.INBOX_DOMAIN.toLowerCase() : "interviewtrack.me";
}

/** 这个人的收信地址。作者账号沿用 jobs@（Gmail 里的过滤器已经设好，不用改）。 */
export function inboxAddress(env: Env, user: User): string {
  if (user.role === "owner") return `jobs@${inboxDomain(env)}`;
  return `u-${user.inbox_token ?? ""}@${inboxDomain(env)}`;
}

/** 允许哪些邮箱把信转进来：登录邮箱 + 自己加的；作者账号再加上 ALLOWED_FORWARDERS。 */
export function effectiveForwarders(env: Env, user: User): string[] {
  const list = [user.email, ...user.forwarders.split(/[,\s]+/)];
  if (user.role === "owner") list.push(...(env.ALLOWED_FORWARDERS ?? "").split(/[,\s]+/));
  return [...new Set(list.map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@")))];
}

export function registrationOpen(env: Env): boolean {
  return env.REGISTRATION !== "closed";
}

function maxUsers(env: Env): number {
  const n = Number(env.MAX_USERS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_USERS;
}

async function userCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return row?.n ?? 0;
}

/** 新账号：一把日历口令、一个收信地址。 */
async function createUser(env: Env, email: string, role: string, nowMs: number, calendar: string = randomHex(20)): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO users (id, email, role, calendar_token, inbox_token, forwarders, ai_enabled, created_at) VALUES (?, ?, ?, ?, ?, '', 1, ?) ON CONFLICT(email) DO NOTHING",
  )
    .bind(crypto.randomUUID(), email, role, calendar, newInboxToken(), new Date(nowMs).toISOString())
    .run();
}

/**
 * 升级到多人版之前的数据（没有 user_id 的邮件和提醒、旧 settings 表里的看板操作 / 偏好 / 简历）归作者。
 * 迁移脚本已经做过一遍；这里兜底「迁移时作者账号还没建」的情况。
 */
async function claimLegacyData(env: Env, ownerId: string): Promise<void> {
  await env.DB.prepare("UPDATE emails SET user_id = ? WHERE user_id = ''").bind(ownerId).run();
  await env.DB.prepare("UPDATE notices SET user_id = ? WHERE user_id = ''").bind(ownerId).run();
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, key, value, updated_at) SELECT ?, key, value, updated_at FROM settings WHERE key IN ${ALL_LEGACY_KEYS} ON CONFLICT(user_id, key) DO NOTHING`,
  )
    .bind(ownerId)
    .run();
  await env.DB.prepare(`DELETE FROM settings WHERE key IN ${ALL_LEGACY_KEYS}`).run();
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 6 位数字验证码，均匀分布（丢掉会造成偏差的那一小段随机数）。 */
export function newCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(buf);
  while ((buf[0] ?? 0) >= limit);
  return String((buf[0] ?? 0) % 1_000_000).padStart(6, "0");
}

export async function userById(env: Env, id: string): Promise<User | null> {
  return env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<User>();
}

async function userByEmail(env: Env, email: string): Promise<User | null> {
  return env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`).bind(email).first<User>();
}

export async function userByCalendarToken(env: Env, token: string): Promise<User | null> {
  return env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE calendar_token = ?`).bind(token).first<User>();
}

export async function userByInboxToken(env: Env, token: string): Promise<User | null> {
  return env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE inbox_token = ?`).bind(token).first<User>();
}

/**
 * 作者账号：没有就建一个。
 * 日历口令沿用以前「由看板密码算出来」的那个——已经订阅的日历不用重订。
 */
export async function ensureOwner(env: Env, nowMs: number): Promise<User | null> {
  const email = normalizeEmail(env.OWNER_EMAIL);
  if (email === null) return null;
  const existing = await userByEmail(env, email);
  // 升级到多人版后第一次：补上收信口令，认领旧数据
  if (existing && existing.inbox_token !== null) return existing;
  if (existing) {
    await env.DB.prepare("UPDATE users SET inbox_token = ? WHERE id = ?").bind(newInboxToken(), existing.id).run();
  } else {
    const legacy = env.BOARD_PASSWORD && env.BOARD_PASSWORD.length > 0 ? await calendarToken(env.BOARD_PASSWORD) : randomHex(20);
    await createUser(env, email, "owner", nowMs, legacy);
  }
  const owner = await userByEmail(env, email);
  if (owner) await claimLegacyData(env, owner.id);
  return owner;
}

/** 允许转信进来的邮箱（除登录邮箱外）：最多 3 个，存小写。 */
export async function setForwarders(env: Env, userId: string, raw: unknown): Promise<string[] | string> {
  if (!Array.isArray(raw)) return "格式不对";
  const list = [...new Set(raw.map((s) => normalizeEmail(s)).filter((s): s is string => s !== null))];
  if (list.length !== raw.length) return "有邮箱格式不对";
  if (list.length > MAX_EXTRA_FORWARDERS) return `最多加 ${MAX_EXTRA_FORWARDERS} 个`;
  await env.DB.prepare("UPDATE users SET forwarders = ? WHERE id = ?").bind(list.join(","), userId).run();
  return list;
}

export async function setAiEnabled(env: Env, userId: string, enabled: boolean): Promise<void> {
  await env.DB.prepare("UPDATE users SET ai_enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, userId).run();
}

/** 换一个新的日历订阅口令：旧链接立刻失效（链接泄露时用）。 */
export async function resetCalendarToken(env: Env, userId: string): Promise<string> {
  const token = randomHex(20);
  await env.DB.prepare("UPDATE users SET calendar_token = ? WHERE id = ?").bind(token, userId).run();
  return token;
}

// ---------- 防机器人 ----------

export type TurnstileCheck = (token: unknown, ip: string) => Promise<boolean>;

/** 用 Cloudflare 的 siteverify 接口验 Turnstile 给浏览器的那张票。 */
export function turnstileChecker(env: Env, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): TurnstileCheck {
  return async (token, ip) => {
    if (typeof token !== "string" || token.length === 0 || token.length > 2048 || !env.TURNSTILE_SECRET) return false;
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", token);
    if (ip !== "unknown") form.append("remoteip", ip);
    try {
      const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
      const body = (await res.json()) as { success?: unknown };
      return body.success === true;
    } catch {
      return false;
    }
  };
}

/**
 * 本地开发的「不设防」模式（跳过人机验证、验证码直接显示在页面上）。
 * 只有 .dev.vars 里写了 DEV_INSECURE_AUTH=1 才打开（.dev.vars 只在本机、不会部署上去）；
 * 而且只要配了 TURNSTILE_SECRET（线上一定配）就一律不算数——线上不可能误开。
 * （本地 wrangler dev 会把请求的网址改写成线上域名，所以不能靠「是不是 localhost」来判断。）
 */
export function devInsecure(env: Env): boolean {
  return env.DEV_INSECURE_AUTH === "1" && !env.TURNSTILE_SECRET;
}

// ---------- 发码 ----------

export type SendCode = (to: string, code: string) => Promise<void>;

/** 用 Cloudflare Email Service 发验证码。 */
export function codeSender(env: Env): SendCode | null {
  const binding = env.EMAIL;
  if (!binding) return null;
  const from = env.LOGIN_FROM && env.LOGIN_FROM.includes("@") ? env.LOGIN_FROM : "login@interviewtrack.me";
  return async (to, code) => {
    await binding.send({
      from: { email: from, name: "准点 InterviewTrack" },
      to,
      subject: `你的登录验证码：${code}`,
      text: [`你的「准点」登录验证码是：${code}`, "", "10 分钟内有效。", "如果不是你本人在登录，忽略这封信即可，别人拿不到这个码就进不来。"].join("\n"),
    });
  };
}

export type RequestCodeResult = { kind: "sent"; devCode?: string } | { kind: "cooldown"; retryAfterSec: number } | { kind: "too_many" } | { kind: "full" };

/**
 * 要一个验证码。开放注册时，没有账号的邮箱也发（验证通过才建账号）；
 * 注册关闭时，没有账号的邮箱照样回答「已发送」但不真发，外人试不出谁有账号。
 * 名额满了：新邮箱直接告诉他满了（不然他会一直等一封不会来的信）。
 * devEcho：本地开发时把码直接返回给页面（不发信）。
 */
export async function requestCode(
  env: Env,
  email: string,
  ip: string,
  nowMs: number,
  send: SendCode | null,
  devEcho = false,
): Promise<RequestCodeResult> {
  const now = new Date(nowMs).toISOString();
  const ipCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_sends WHERE ip = ? AND at > ?")
    .bind(ip, new Date(nowMs - HOUR).toISOString())
    .first<{ n: number }>();
  if ((ipCount?.n ?? 0) >= MAX_SENDS_PER_IP_HOUR) return { kind: "too_many" };

  const row = await env.DB.prepare("SELECT last_sent_at, window_start, window_sends FROM login_codes WHERE email = ?")
    .bind(email)
    .first<{ last_sent_at: string; window_start: string; window_sends: number }>();
  if (row) {
    const since = nowMs - Date.parse(row.last_sent_at);
    if (since < RESEND_COOLDOWN_MS) return { kind: "cooldown", retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - since) / 1000) };
    if (nowMs - Date.parse(row.window_start) < HOUR && row.window_sends >= MAX_SENDS_PER_EMAIL_HOUR) return { kind: "too_many" };
  }
  const freshWindow = !row || nowMs - Date.parse(row.window_start) >= HOUR;
  const windowStart = freshWindow ? now : (row?.window_start ?? now);
  const windowSends = freshWindow ? 1 : (row?.window_sends ?? 0) + 1;

  const user = await userByEmail(env, email);
  const canRegister = user === null && registrationOpen(env);
  if (canRegister && (await userCount(env)) >= maxUsers(env)) return { kind: "full" };
  await env.DB.prepare("INSERT INTO login_sends (ip, at) VALUES (?, ?)").bind(ip, now).run();
  const code = user !== null || canRegister ? newCode() : null;
  const hash = code ? await codeHash(signingSecret(env), email, code) : null;
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code_hash, expires_at, attempts, last_sent_at, window_start, window_sends) VALUES (?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
       last_sent_at = excluded.last_sent_at, window_start = excluded.window_start, window_sends = excluded.window_sends`,
  )
    .bind(email, hash, code ? new Date(nowMs + CODE_TTL_MS).toISOString() : null, now, windowStart, windowSends)
    .run();
  if (code === null) return { kind: "sent" };
  if (devEcho) return { kind: "sent", devCode: code };
  if (send) {
    try {
      await send(email, code);
    } catch (error) {
      // 没发出去：这次不算数（不占 60 秒冷却和每小时次数，码也作废），让人能马上重试
      if (row) {
        await env.DB.prepare("UPDATE login_codes SET code_hash = NULL, expires_at = NULL, last_sent_at = ?, window_start = ?, window_sends = ? WHERE email = ?")
          .bind(row.last_sent_at, row.window_start, row.window_sends, email)
          .run();
      } else {
        await env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(email).run();
      }
      throw error;
    }
  }
  return { kind: "sent" };
}

export type VerifyCodeResult = { kind: "ok"; user: User } | { kind: "wrong"; attemptsLeft: number } | { kind: "expired" };

/** 核对验证码。对了就作废这个码（只能用一次）；错了记一次，满 5 次作废。 */
export async function verifyCode(env: Env, email: string, code: unknown, nowMs: number): Promise<VerifyCodeResult> {
  const row = await env.DB.prepare("SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?")
    .bind(email)
    .first<{ code_hash: string | null; expires_at: string | null; attempts: number }>();
  if (!row || row.code_hash === null || row.expires_at === null || Date.parse(row.expires_at) <= nowMs || row.attempts >= MAX_CODE_ATTEMPTS) {
    return { kind: "expired" };
  }
  const input = typeof code === "string" ? code.replace(/\s+/g, "") : "";
  const ok = /^\d{6}$/.test(input) && sameString(await codeHash(signingSecret(env), email, input), row.code_hash);
  if (!ok) {
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
    const left = MAX_CODE_ATTEMPTS - row.attempts - 1;
    return left > 0 ? { kind: "wrong", attemptsLeft: left } : { kind: "expired" };
  }
  await env.DB.prepare("UPDATE login_codes SET code_hash = NULL, expires_at = NULL WHERE email = ?").bind(email).run();
  // 验证通过、还没有账号：现在建（发码时已经确认过注册开着、名额没满）
  if ((await userByEmail(env, email)) === null && registrationOpen(env)) await createUser(env, email, "member", nowMs);
  const user = await userByEmail(env, email);
  return user ? { kind: "ok", user } : { kind: "expired" };
}
