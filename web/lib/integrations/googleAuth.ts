import {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
  type GoogleEnv,
} from "@/lib/integrations/googleEnv";
import type { GoogleSession } from "@/lib/integrations/session";

/** 构造同意页地址。state 用来防 CSRF，回调时必须比对。 */
export function buildAuthUrl(env: GoogleEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // offline + consent 才拿得到 refresh_token；只 offline 的话
    // 第二次授权 Google 不会再给，之后就没法后台刷新了
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return (await res.json()) as TokenResponse;
}

export interface ExchangeResult {
  ok: boolean;
  session?: GoogleSession;
  error?: string;
}

/** 用授权码换令牌。 */
export async function exchangeCode(
  env: GoogleEnv,
  code: string,
): Promise<ExchangeResult> {
  const data = await postToken(
    new URLSearchParams({
      code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: "authorization_code",
    }),
  );

  if (data.error || !data.access_token) {
    return { ok: false, error: data.error_description ?? data.error ?? "换取令牌失败" };
  }
  if (!data.refresh_token) {
    // 通常是这个账号之前授权过、Google 不再下发 refresh_token。
    // 到 https://myaccount.google.com/permissions 移除本应用后重试即可。
    return {
      ok: false,
      error: "Google 未返回 refresh_token，请先在账号的第三方权限里移除本应用再重新授权",
    };
  }

  return {
    ok: true,
    session: {
      refreshToken: data.refresh_token,
      account: emailFromIdToken(data.id_token) ?? "未知账号",
      accessToken: data.access_token,
      accessTokenExpiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    },
  };
}

/**
 * 取一个可用的 access token：没过期就复用，过期了用 refresh token 换新的。
 * 返回新的 session（可能带更新后的缓存），调用方负责写回 cookie。
 */
export async function ensureAccessToken(
  env: GoogleEnv,
  session: GoogleSession,
): Promise<{ token: string; session: GoogleSession } | { error: string }> {
  const stillValid =
    session.accessToken &&
    session.accessTokenExpiresAt &&
    session.accessTokenExpiresAt - 60_000 > Date.now();
  if (stillValid && session.accessToken) {
    return { token: session.accessToken, session };
  }

  const data = await postToken(
    new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      refresh_token: session.refreshToken,
      grant_type: "refresh_token",
    }),
  );
  if (data.error || !data.access_token) {
    return { error: data.error_description ?? data.error ?? "刷新令牌失败" };
  }
  return {
    token: data.access_token,
    session: {
      ...session,
      accessToken: data.access_token,
      accessTokenExpiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    },
  };
}

/** 断开连接时同时到 Google 侧吊销，不只是删本地 cookie。 */
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    await fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch {
    // 吊销失败也要让本地断开，不能把用户卡在「连着」的状态
  }
}

/**
 * 从 id_token 里取邮箱。只做 base64 解码读 payload，不验签——
 * 这个值仅用于界面显示「已连接 xxx@gmail.com」，不作为任何鉴权依据。
 */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
    };
    return json.email ?? null;
  } catch {
    return null;
  }
}
