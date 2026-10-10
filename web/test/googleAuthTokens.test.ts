import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ensureAccessToken,
  exchangeCode,
  revokeToken,
} from "@/lib/integrations/googleAuth";
import type { GoogleSession } from "@/lib/integrations/session";

const env = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3000/api/integrations/google/callback",
  sessionSecret: "x".repeat(48),
};

/**
 * 只打桩 Google 的令牌端点——那是外部服务，本地测不了真的。
 * 断言全部落在我们自己的逻辑上：缓存判定、错误映射、字段取舍，
 * 不去断言「fetch 被调了几次」那种只能证明桩работает的东西。
 */
function stubToken(payload: unknown) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: new URLSearchParams(String(init.body)) });
    return { json: async () => payload } as Response;
  });
  return calls;
}

/** 造一个 id_token：只有 payload 段是真的，签名段随便填——实现本来就不验签。 */
function idTokenWith(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

afterEach(() => vi.unstubAllGlobals());

describe("exchangeCode", () => {
  test("拿到令牌时组装出完整 session", async () => {
    stubToken({
      access_token: "ya29.new",
      refresh_token: "1//refresh",
      expires_in: 3599,
      id_token: idTokenWith({ email: "me@example.com" }),
    });

    const result = await exchangeCode(env, "auth-code");

    expect(result.ok).toBe(true);
    expect(result.session?.refreshToken).toBe("1//refresh");
    expect(result.session?.accessToken).toBe("ya29.new");
    expect(result.session?.account).toBe("me@example.com");
  });

  test("用 authorization_code 授权类型，并带上 code 与回调地址", async () => {
    const calls = stubToken({ access_token: "a", refresh_token: "r" });

    await exchangeCode(env, "auth-code");

    expect(calls[0].body.get("grant_type")).toBe("authorization_code");
    expect(calls[0].body.get("code")).toBe("auth-code");
    expect(calls[0].body.get("redirect_uri")).toBe(env.redirectUri);
  });

  test("Google 报错时把它的描述带回来", async () => {
    stubToken({ error: "invalid_grant", error_description: "Code was already redeemed" });

    const result = await exchangeCode(env, "用过的码");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Code was already redeemed");
    expect(result.session).toBeUndefined();
  });

  /** 之前授权过的账号 Google 不再下发 refresh_token，没有它就没法后台刷新。 */
  test("没有 refresh_token 时明确失败，并告诉用户怎么办", async () => {
    stubToken({ access_token: "ya29.new", expires_in: 3600 });

    const result = await exchangeCode(env, "auth-code");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("第三方权限");
  });

  test("id_token 缺失或畸形时账号名降级，不影响换取本身", async () => {
    stubToken({ access_token: "a", refresh_token: "r" });
    expect((await exchangeCode(env, "c")).session?.account).toBe("未知账号");

    vi.unstubAllGlobals();
    stubToken({ access_token: "a", refresh_token: "r", id_token: "不是jwt" });
    expect((await exchangeCode(env, "c")).session?.account).toBe("未知账号");
  });
});

describe("ensureAccessToken", () => {
  const base: GoogleSession = { refreshToken: "1//refresh", account: "me@example.com" };

  test("缓存还没过期就直接复用，不去打 Google", async () => {
    const calls = stubToken({ access_token: "不该用到这个" });
    const session: GoogleSession = {
      ...base,
      accessToken: "ya29.cached",
      accessTokenExpiresAt: Date.now() + 10 * 60_000,
    };

    const result = await ensureAccessToken(env, session);

    expect("token" in result && result.token).toBe("ya29.cached");
    expect(calls).toHaveLength(0);
  });

  /** 留 60 秒安全边界：正好卡在过期线上的令牌，用出去可能路上就失效了。 */
  test("距过期不到 60 秒就当作已过期，去换新的", async () => {
    stubToken({ access_token: "ya29.fresh", expires_in: 3600 });
    const session: GoogleSession = {
      ...base,
      accessToken: "ya29.快过期",
      accessTokenExpiresAt: Date.now() + 30_000,
    };

    const result = await ensureAccessToken(env, session);

    expect("token" in result && result.token).toBe("ya29.fresh");
  });

  test("完全没有缓存时去换新的，并把新的过期时间写回 session", async () => {
    stubToken({ access_token: "ya29.fresh", expires_in: 3600 });
    const before = Date.now();

    const result = await ensureAccessToken(env, base);

    expect("session" in result).toBe(true);
    if ("session" in result) {
      expect(result.session.accessToken).toBe("ya29.fresh");
      expect(result.session.accessTokenExpiresAt).toBeGreaterThanOrEqual(
        before + 3600 * 1000,
      );
      // refresh token 原样保留，别在刷新时把它弄丢
      expect(result.session.refreshToken).toBe(base.refreshToken);
    }
  });

  test("刷新用 refresh_token 授权类型", async () => {
    const calls = stubToken({ access_token: "a", expires_in: 3600 });

    await ensureAccessToken(env, base);

    expect(calls[0].body.get("grant_type")).toBe("refresh_token");
    expect(calls[0].body.get("refresh_token")).toBe(base.refreshToken);
  });

  /** 改密码、撤权限、90 天没用，refresh token 都会失效。 */
  test("refresh token 失效时返回错误而不是抛异常", async () => {
    stubToken({ error: "invalid_grant", error_description: "Token has been expired or revoked." });

    const result = await ensureAccessToken(env, base);

    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("revoked");
  });
});

describe("revokeToken", () => {
  test("把令牌发给吊销端点", async () => {
    const calls = stubToken({});

    await revokeToken("1//refresh");

    expect(calls[0].url).toBe("https://oauth2.googleapis.com/revoke");
    expect(calls[0].body.get("token")).toBe("1//refresh");
  });

  /** 吊销失败也不能把用户卡在「连着」的状态，本地断开必须照常进行。 */
  test("网络挂了也不抛异常", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    await expect(revokeToken("1//refresh")).resolves.toBeUndefined();
  });
});
