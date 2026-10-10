import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { readGoogleEnv } from "@/lib/integrations/googleEnv";
import { buildAuthUrl } from "@/lib/integrations/googleAuth";

export const OAUTH_STATE_COOKIE = "jcc_gstate";

/**
 * GET /api/integrations/google/start
 * 把用户送去 Google 同意页。
 *
 * state 存在短时效的 httpOnly cookie 里，回调时逐字比对——
 * 少了这一步，别人可以拿自己的授权码诱导你的浏览器完成绑定（OAuth CSRF）。
 */
export async function GET(): Promise<NextResponse> {
  const env = readGoogleEnv();
  if (!env.configured) {
    return NextResponse.json(
      {
        ok: false,
        error: "尚未配置 Google OAuth",
        missing: env.missing,
        hint: "把凭据填进项目根目录的 .env.local，参考 .env.local.example",
      },
      { status: 503 },
    );
  }

  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(buildAuthUrl(env, state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: env.redirectUri.startsWith("https://"),
    maxAge: 600,
  });
  return response;
}
