import { NextResponse } from "next/server";
import { readGoogleEnv } from "@/lib/integrations/googleEnv";
import { exchangeCode } from "@/lib/integrations/googleAuth";
import {
  GOOGLE_SESSION_COOKIE,
  sealSession,
  sessionCookieOptions,
} from "@/lib/integrations/session";
import { OAUTH_STATE_COOKIE } from "@/app/api/integrations/google/start/route";

/**
 * GET /api/integrations/google/callback?code=...&state=...
 *
 * 换取令牌并写进加密 cookie，然后跳回首页。
 * 失败时也跳回首页并带上 ?google=error，由界面提示，
 * 而不是把用户扔在一个 JSON 报错页上。
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  // Google 日历的入口在旧版看板上，授权完回到那里
  const home = new URL("/board", url.origin);

  const env = readGoogleEnv();
  if (!env.configured) {
    home.searchParams.set("google", "unconfigured");
    return NextResponse.redirect(home);
  }

  const error = url.searchParams.get("error");
  if (error) {
    // 用户在同意页点了取消
    home.searchParams.set("google", error === "access_denied" ? "denied" : "error");
    return NextResponse.redirect(home);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = request.headers
    .get("cookie")
    ?.split("; ")
    .find((row) => row.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);

  // state 不匹配一律拒绝，不去猜是不是自己发起的
  if (!code || !state || !expected || state !== expected) {
    home.searchParams.set("google", "state_mismatch");
    return NextResponse.redirect(home);
  }

  const result = await exchangeCode(env, code);
  if (!result.ok || !result.session) {
    home.searchParams.set("google", "exchange_failed");
    return NextResponse.redirect(home);
  }

  home.searchParams.set("google", "connected");
  const response = NextResponse.redirect(home);
  const secure = env.redirectUri.startsWith("https://");
  response.cookies.set(
    GOOGLE_SESSION_COOKIE,
    sealSession(result.session, env.sessionSecret),
    sessionCookieOptions(secure),
  );
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
