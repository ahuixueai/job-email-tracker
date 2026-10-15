/**
 * 看板的登录凭据：一张签过名的 cookie，里面是「谁 + 什么时候过期 + 签名」。
 *
 * 怎么拿到它：邮箱验证码（accounts.ts），或者作者账号的备用密码。
 * 签名的钥匙是 SESSION_SECRET（`wrangler secret put`，不进任何文件）；没设时退回用看板密码——那样改密码会让所有已登录的设备失效。
 */

export const SESSION_COOKIE = "it_session";
export const SESSION_DAYS = 30;
/** 同一来源一小时内允许的失败次数。 */
export const MAX_FAILURES_PER_HOUR = 10;

const encoder = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 长度相同才逐字比较，且总是比完——不因为前几位不同就提前返回。 */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 密码对不对。两边各做一次 HMAC 再比，比较时间与密码内容无关，也不受长度差异影响。
 */
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  if (expected.length === 0) return false;
  const [a, b] = await Promise.all([hmacHex("password-check", input), hmacHex("password-check", expected)]);
  return sameString(a, b);
}

export async function issueSession(secret: string, userId: string, nowMs: number): Promise<{ value: string; maxAge: number }> {
  const expires = nowMs + SESSION_DAYS * 86_400_000;
  return { value: `${userId}.${expires}.${await hmacHex(secret, `session:${userId}:${expires}`)}`, maxAge: SESSION_DAYS * 86_400 };
}

/** cookie 有效就返回是谁（用户 id），否则 null。旧格式（没有用户 id 的）一律无效，重新登录一次。 */
export async function sessionUser(cookieValue: string | null, secret: string, nowMs: number): Promise<string | null> {
  if (!cookieValue || secret.length === 0) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresText, sig] = parts as [string, string, string];
  if (!/^[A-Za-z0-9-]{1,64}$/.test(userId)) return null;
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires <= nowMs) return null;
  return sameString(sig, await hmacHex(secret, `session:${userId}:${expires}`)) ? userId : null;
}

/** 签名用的钥匙：优先 SESSION_SECRET，没设就用看板密码。都没有返回空串（那就谁也登不进来）。 */
export function signingSecret(env: { SESSION_SECRET?: string; BOARD_PASSWORD?: string }): string {
  return env.SESSION_SECRET && env.SESSION_SECRET.length > 0 ? env.SESSION_SECRET : (env.BOARD_PASSWORD ?? "");
}

/** 验证码只存哈希：钥匙 + 邮箱 + 码。数据库泄露也拿不到码。 */
export function codeHash(secret: string, email: string, code: string): Promise<string> {
  return hmacHex(secret, `login-code:${email}:${code}`);
}

export { sameString };

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
