/**
 * Google OAuth 的运行时配置。
 *
 * 这些值必须由你自己在 Google Cloud 建好后填进 .env.local——
 * 我不经手你的凭据，代码只从环境变量读，任何时候都不会把它们写进仓库。
 * .env.local 已在 .gitignore 里。
 */

export interface GoogleEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
}

export interface EnvProblem {
  configured: false;
  missing: string[];
}

export type EnvResult = ({ configured: true } & GoogleEnv) | EnvProblem;

/**
 * 读取并校验配置。缺什么就把缺的字段名列出来，
 * 让前端能直接告诉用户「还差哪一项」，而不是抛一个 500。
 */
export function readGoogleEnv(): EnvResult {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    "http://localhost:3000/api/integrations/google/callback";
  const sessionSecret = process.env.JCC_SESSION_SECRET ?? "";

  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  // 会话密钥用来加密存在 cookie 里的 refresh token，不能省
  if (sessionSecret.length < 32) missing.push("JCC_SESSION_SECRET（至少 32 字符）");

  if (missing.length > 0) return { configured: false, missing };
  return { configured: true, clientId, clientSecret, redirectUri, sessionSecret };
}

/**
 * 申请的权限范围。只要真正用到的那几个。
 *
 * calendar.readonly 是只读——本轮不往你的日历里写东西。等双向同步真正做起来
 * 再谈 calendar.events 的写权限，那时候应该重新走一次授权，而不是一开始就多要。
 *
 * 曾经这里还有 gmail.readonly，已删。两个原因：
 * 1. 代码里一处 Gmail 调用都没有，等于在同意页上白要用户整个邮箱的读权限；
 * 2. 它是 restricted scope，申请就要过 CASA Tier 2（$3,000+/年、每年复审），
 *    而 docs/PROJECT-MEMORY.md 的既定决策是邮件走转发、不走 Gmail OAuth。
 * 真要读邮件时，走转发那条路，不要把这一行加回来。
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
