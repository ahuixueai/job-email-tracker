import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * refresh token 存在加密的 httpOnly cookie 里。
 *
 * 为什么不放数据库：这个项目按需求是不带后端存储的单机原型，加一套 DB 的
 * 运维成本远大于收益。为什么不放 localStorage：那是 XSS 直接可读的地方，
 * refresh token 泄露等于长期访问权限被拿走。
 *
 * httpOnly + SameSite=Lax + AES-256-GCM 加密，是这个部署形态下的合理折中。
 * 真上多用户生产环境时，应该换成服务端会话存储 + 令牌加密落库。
 */

export const GOOGLE_SESSION_COOKIE = "jcc_gsess";

export interface GoogleSession {
  refreshToken: string;
  /** 授权的账号邮箱，仅用于界面显示。 */
  account: string;
  /** 缓存的 access token 与其过期时间，省掉每次都刷新。 */
  accessToken?: string;
  accessTokenExpiresAt?: number;
}

const IV_BYTES = 12;
const KEY_BYTES = 32;
/** 固定 salt：密钥本身来自足够长的随机 secret，这里只做 KDF 拉伸。 */
const SALT = "jcc-google-session-v1";

function keyFrom(secret: string): Buffer {
  return scryptSync(secret, SALT, KEY_BYTES);
}

export function sealSession(session: GoogleSession, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map((b) => b.toString("base64url")).join(".");
}

/**
 * 解密。任何一步不对（被篡改、密钥换了、格式不对）都返回 null，
 * 由调用方当作「未连接」处理——绝不能因为一个坏 cookie 就把整页打成 500。
 */
export function openSession(
  sealed: string | undefined,
  secret: string,
): GoogleSession | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(body),
      decipher.final(),
    ]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as GoogleSession).refreshToken !== "string"
    ) {
      return null;
    }
    return parsed as GoogleSession;
  } catch {
    return null;
  }
}

/** Set-Cookie 的属性串。生产环境（https）再加 Secure。 */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: 60 * 60 * 24 * 90,
  };
}
