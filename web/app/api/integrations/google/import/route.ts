import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readGoogleEnv } from "@/lib/integrations/googleEnv";
import { ensureAccessToken } from "@/lib/integrations/googleAuth";
import {
  GOOGLE_SESSION_COOKIE,
  openSession,
  sealSession,
  sessionCookieOptions,
} from "@/lib/integrations/session";
import { parseEvents, type GoogleEvent } from "@/lib/integrations/parseCalendar";

/**
 * GET /api/integrations/google/import?days=45&tz=Asia/Shanghai
 *
 * 拉取未来 N 天的日历事件，筛出看起来像面试的，解析成候选返回。
 * 这里只读不写，也不直接入库——候选要经用户在界面上勾选确认才进列表。
 */
export async function GET(request: Request): Promise<NextResponse> {
  const env = readGoogleEnv();
  if (!env.configured) {
    return NextResponse.json(
      { ok: false, error: "尚未配置 Google OAuth", missing: env.missing },
      { status: 503 },
    );
  }

  const store = await cookies();
  const session = openSession(
    store.get(GOOGLE_SESSION_COOKIE)?.value,
    env.sessionSecret,
  );
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "还没有连接 Google 账号" },
      { status: 401 },
    );
  }

  const auth = await ensureAccessToken(env, session);
  if ("error" in auth) {
    // refresh token 失效（改密码、撤权限、90 天未用）时走到这里
    const dead = NextResponse.json(
      { ok: false, error: `授权已失效，请重新连接：${auth.error}` },
      { status: 401 },
    );
    dead.cookies.delete(GOOGLE_SESSION_COOKIE);
    return dead;
  }

  const url = new URL(request.url);
  const days = clamp(Number(url.searchParams.get("days") ?? 45), 1, 180);
  const fallbackTz = url.searchParams.get("tz") || "UTC";

  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + days * 86_400_000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { authorization: `Bearer ${auth.token}` } },
  );
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `Google Calendar 返回 ${res.status}` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as { items?: GoogleEvent[] };
  const candidates = parseEvents(data.items ?? [], fallbackTz);

  const response = NextResponse.json({
    ok: true,
    scanned: data.items?.length ?? 0,
    candidates,
  });
  // access token 可能刚刷新过，把新的缓存写回 cookie
  if (auth.session !== session) {
    response.cookies.set(
      GOOGLE_SESSION_COOKIE,
      sealSession(auth.session, env.sessionSecret),
      sessionCookieOptions(env.redirectUri.startsWith("https://")),
    );
  }
  return response;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
