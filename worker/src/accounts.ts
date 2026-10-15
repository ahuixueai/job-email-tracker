import { codeHash, sameString, signingSecret } from "./auth.js";
import { calendarToken } from "./calendar.js";
import type { Env } from "./types.js";

/**
 * 账号与邮箱验证码登录（第 1 期）。
 *
 * - 第 1 期只有作者一个账号（OWNER_EMAIL），不开放注册；表结构按多人设计
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
}

const USER_COLUMNS = "id, email, role, calendar_token";

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

/**
 * 作者账号：没有就建一个。
 * 日历口令沿用以前「由看板密码算出来」的那个——已经订阅的日历不用重订。
 */
export async function ensureOwner(env: Env, nowMs: number): Promise<User | null> {
  const email = normalizeEmail(env.OWNER_EMAIL);
  if (email === null) return null;
  const existing = await userByEmail(env, email);
  if (existing) return existing;
  const legacy = env.BOARD_PASSWORD && env.BOARD_PASSWORD.length > 0 ? await calendarToken(env.BOARD_PASSWORD) : randomHex(20);
  const user: User = { id: crypto.randomUUID(), email, role: "owner", calendar_token: legacy };
  await env.DB.prepare("INSERT INTO users (id, email, role, calendar_token, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING")
    .bind(user.id, user.email, user.role, user.calendar_token, new Date(nowMs).toISOString())
    .run();
  return userByEmail(env, email);
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
      from: { email: from, name: "求职看板" },
      to,
      subject: `你的登录验证码：${code}`,
      text: [`你的求职看板登录验证码是：${code}`, "", "10 分钟内有效。", "如果不是你本人在登录，忽略这封信即可，别人拿不到这个码就进不来。"].join("\n"),
    });
  };
}

export type RequestCodeResult = { kind: "sent"; devCode?: string } | { kind: "cooldown"; retryAfterSec: number } | { kind: "too_many" };

/**
 * 要一个验证码。不管邮箱有没有账号，回答都一样（除了频率限制，对谁都一样）。
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

  await env.DB.prepare("INSERT INTO login_sends (ip, at) VALUES (?, ?)").bind(ip, now).run();
  const user = await userByEmail(env, email);
  const code = user ? newCode() : null;
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
  if (send) await send(email, code);
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
  const user = await userByEmail(env, email);
  return user ? { kind: "ok", user } : { kind: "expired" };
}
