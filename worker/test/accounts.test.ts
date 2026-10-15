import { describe, expect, it } from "vitest";
import { newCode, normalizeEmail } from "../src/accounts.js";
import { handleApi } from "../src/api.js";
import type { ApiDeps } from "../src/api.js";
import type { Env } from "../src/types.js";
import { fakeDb } from "./fakeDb.js";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const OWNER = "owner@example.com";

function setup(over: Partial<Env> = {}) {
  const fake = fakeDb();
  const env: Env = { DB: fake.db, BOARD_PASSWORD: "pw", SESSION_SECRET: "sess", OWNER_EMAIL: OWNER, TURNSTILE_SECRET: "ts", ...over };
  const sent: { to: string; code: string }[] = [];
  const deps: ApiDeps = {
    checkTurnstile: (token) => Promise.resolve(token === "human"),
    sendCode: (to, code) => {
      sent.push({ to, code });
      return Promise.resolve();
    },
  };
  const call = (path: string, body?: unknown, opts: { ip?: string; at?: number; cookie?: string; host?: string } = {}) =>
    handleApi(
      new Request(`https://${opts.host ?? "board.example"}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "cf-connecting-ip": opts.ip ?? "203.0.113.5", ...(opts.cookie ? { cookie: opts.cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      opts.at ?? NOW,
      deps,
    );
  return { ...fake, env, sent, call };
}

const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

describe("邮箱验证码登录", () => {
  it("要码 → 收到 6 位码 → 填对登录；登录的是作者账号", async () => {
    const { call, sent } = setup();
    const res = await call("/api/auth/code", { email: " Owner@Example.com ", turnstile: "human" });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(OWNER);
    expect(sent[0]!.code).toMatch(/^\d{6}$/);
    const ok = await call("/api/auth/verify", { email: OWNER, code: sent[0]!.code });
    expect(ok.status).toBe(200);
    const session = await call("/api/session", undefined, { cookie: cookieOf(ok) });
    expect(((await session.json()) as { user: { email: string; role: string } }).user).toEqual({ email: OWNER, role: "owner" });
  });

  it("不在名单里的邮箱：回答一样是「已发送」，但不真发", async () => {
    const { call, sent } = setup();
    const res = await call("/api/auth/code", { email: "stranger@example.com", turnstile: "human" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    const verify = await call("/api/auth/verify", { email: "stranger@example.com", code: "123456" });
    expect(verify.status).toBe(401);
  });

  it("没过人机验证：不发", async () => {
    const { call, sent } = setup();
    expect((await call("/api/auth/code", { email: OWNER, turnstile: "bot" })).status).toBe(403);
    expect((await call("/api/auth/code", { email: OWNER })).status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("60 秒内不能重发；一小时最多 5 次；对不存在的邮箱一样限制", async () => {
    const { call } = setup();
    for (const email of [OWNER, "stranger@example.com"]) {
      expect((await call("/api/auth/code", { email, turnstile: "human" })).status).toBe(200);
      const again = await call("/api/auth/code", { email, turnstile: "human" }, { at: NOW + 30_000 });
      expect(again.status).toBe(429);
      expect(((await again.json()) as { retryAfter: number }).retryAfter).toBe(30);
      for (let i = 1; i < 5; i += 1) expect((await call("/api/auth/code", { email, turnstile: "human" }, { at: NOW + i * 61_000 })).status).toBe(200);
      expect((await call("/api/auth/code", { email, turnstile: "human" }, { at: NOW + 6 * 61_000 })).status).toBe(429);
      // 一小时后重新计数
      expect((await call("/api/auth/code", { email, turnstile: "human" }, { at: NOW + 3_700_000 })).status).toBe(200);
    }
  });

  it("同一来源一小时最多发 20 次（换着邮箱刷也不行）", async () => {
    const { call } = setup();
    for (let i = 0; i < 20; i += 1) expect((await call("/api/auth/code", { email: `a${i}@example.com`, turnstile: "human" })).status).toBe(200);
    expect((await call("/api/auth/code", { email: "b@example.com", turnstile: "human" })).status).toBe(429);
    expect((await call("/api/auth/code", { email: "b@example.com", turnstile: "human" }, { ip: "198.51.100.9" })).status).toBe(200);
  });

  it("填错：告诉还能试几次；错满 5 次这个码作废；对的码也只能用一次；10 分钟过期", async () => {
    const { call, sent } = setup();
    await call("/api/auth/code", { email: OWNER, turnstile: "human" });
    const code = sent[0]!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    const first = await call("/api/auth/verify", { email: OWNER, code: wrong });
    expect(((await first.json()) as { error: string }).error).toBe("验证码不对，还能试 4 次");
    for (let i = 0; i < 4; i += 1) await call("/api/auth/verify", { email: OWNER, code: wrong }, { ip: `198.51.100.${i}` });
    const dead = await call("/api/auth/verify", { email: OWNER, code }, { ip: "192.0.2.1" });
    expect(((await dead.json()) as { error: string }).error).toBe("验证码已失效，请重新获取");

    await call("/api/auth/code", { email: OWNER, turnstile: "human" }, { at: NOW + 61_000 });
    const second = sent[1]!.code;
    expect((await call("/api/auth/verify", { email: OWNER, code: second }, { ip: "192.0.2.2", at: NOW + 62_000 })).status).toBe(200);
    expect((await call("/api/auth/verify", { email: OWNER, code: second }, { ip: "192.0.2.3", at: NOW + 63_000 })).status).toBe(401);

    await call("/api/auth/code", { email: OWNER, turnstile: "human" }, { at: NOW + 200_000 });
    const third = sent[2]!.code;
    expect((await call("/api/auth/verify", { email: OWNER, code: third }, { ip: "192.0.2.4", at: NOW + 200_000 + 10 * 60_000 + 1 })).status).toBe(401);
  });

  it("没配好防机器人或发信：不发，提示先用密码；配好了密码登录也要过人机验证", async () => {
    const noTs = setup({ TURNSTILE_SECRET: "" });
    expect((await noTs.call("/api/auth/code", { email: OWNER, turnstile: "human" })).status).toBe(503);
    const { call } = setup();
    expect((await call("/api/login", { password: "pw", turnstile: "bot" })).status).toBe(403);
    const ok = await call("/api/login", { password: "pw", turnstile: "human" });
    expect(ok.status).toBe(200);
    expect((await call("/api/session", undefined, { cookie: cookieOf(ok) })).status).toBe(200);
  });

  it("本地开发模式：验证码直接返回给页面；只要配了 TURNSTILE_SECRET（线上）就不算数", async () => {
    const { call, sent } = setup({ DEV_INSECURE_AUTH: "1", TURNSTILE_SECRET: "" });
    const local = await call("/api/auth/code", { email: OWNER });
    const body = (await local.json()) as { devCode?: string };
    expect(body.devCode).toMatch(/^\d{6}$/);
    expect(sent).toHaveLength(0);
    const online = setup({ DEV_INSECURE_AUTH: "1" });
    const config = (await (await online.call("/api/auth/config")).json()) as { devMode: boolean };
    expect(config.devMode).toBe(false);
    expect((await online.call("/api/auth/code", { email: OWNER })).status).toBe(403);
  });

  it("账号被删掉后，它的 cookie 立刻失效", async () => {
    const { call, users } = setup();
    const ok = await call("/api/login", { password: "pw", turnstile: "human" });
    users.splice(0, users.length);
    expect((await call("/api/session", undefined, { cookie: cookieOf(ok) })).status).toBe(401);
  });
});

describe("小工具", () => {
  it("邮箱：去空格、转小写、格式不对的不要", () => {
    expect(normalizeEmail("  A@B.Com ")).toBe("a@b.com");
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail(3)).toBeNull();
  });
  it("验证码：6 位数字", () => {
    for (let i = 0; i < 50; i += 1) expect(newCode()).toMatch(/^\d{6}$/);
  });
});
