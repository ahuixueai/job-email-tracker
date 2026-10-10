import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readGoogleEnv } from "@/lib/integrations/googleEnv";
import { GOOGLE_SESSION_COOKIE, openSession } from "@/lib/integrations/session";

/**
 * GET /api/integrations/google/status
 * 界面靠它决定显示「连接 Google」还是「已连接 xxx@gmail.com」。
 * 只回邮箱，绝不把令牌回给前端。
 */
export async function GET(): Promise<NextResponse> {
  const env = readGoogleEnv();
  if (!env.configured) {
    return NextResponse.json({ configured: false, connected: false, missing: env.missing });
  }
  const store = await cookies();
  const session = openSession(store.get(GOOGLE_SESSION_COOKIE)?.value, env.sessionSecret);
  return NextResponse.json({
    configured: true,
    connected: session !== null,
    account: session?.account ?? null,
  });
}
