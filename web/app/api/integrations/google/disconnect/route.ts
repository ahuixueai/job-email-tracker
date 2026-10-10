import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readGoogleEnv } from "@/lib/integrations/googleEnv";
import { revokeToken } from "@/lib/integrations/googleAuth";
import { GOOGLE_SESSION_COOKIE, openSession } from "@/lib/integrations/session";

/**
 * POST /api/integrations/google/disconnect
 * 断开连接：先到 Google 侧吊销 refresh token，再删本地 cookie。
 * 只删 cookie 的话，令牌在 Google 那边仍然有效。
 */
export async function POST(): Promise<NextResponse> {
  const env = readGoogleEnv();
  if (env.configured) {
    const store = await cookies();
    const session = openSession(
      store.get(GOOGLE_SESSION_COOKIE)?.value,
      env.sessionSecret,
    );
    if (session) await revokeToken(session.refreshToken);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(GOOGLE_SESSION_COOKIE);
  return response;
}
