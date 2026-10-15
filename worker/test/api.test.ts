import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api.js";
import type { Env } from "../src/types.js";
import { fakeDb } from "./fakeDb.js";

const NOW = Date.parse("2026-10-12T04:00:00Z");
const PASSWORD = "test-board-password";
const BASE = "https://board.example";

function env(db = fakeDb().db, over: Partial<Env> = {}): Env {
  return { DB: db, BOARD_PASSWORD: PASSWORD, OWNER_EMAIL: "owner@example.com", ...over };
}

function req(path: string, init: RequestInit & { cookie?: string; ip?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  headers.set("cf-connecting-ip", init.ip ?? "203.0.113.7");
  return new Request(`${BASE}${path}`, { ...init, headers });
}

async function login(e: Env): Promise<string> {
  const res = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) }), e, NOW);
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0]!;
}

describe("看板接口", () => {
  it("没登录：除了登录本身，一律 401，且不透露任何数据", async () => {
    const e = env();
    for (const path of ["/api/session", "/api/emails", "/api/notices", "/api/edits"]) {
      const res = await handleApi(req(path), e, NOW);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    const put = await handleApi(req("/api/edits", { method: "PUT", body: "{}" }), e, NOW);
    expect(put.status).toBe(401);
  });

  it("还没设密码：登录直接拒绝并说明怎么设", async () => {
    const res = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: "" }) }), env(fakeDb().db, { BOARD_PASSWORD: "" }), NOW);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("BOARD_PASSWORD");
  });

  it("密码错 10 次后同一来源锁一小时，换个来源不受影响", async () => {
    const { db, loginFailures } = fakeDb();
    const e = env(db);
    for (let i = 0; i < 10; i += 1) {
      const res = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: "nope" }) }), e, NOW);
      expect(res.status).toBe(401);
    }
    expect(loginFailures).toHaveLength(10);
    const locked = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) }), e, NOW);
    expect(locked.status).toBe(429);
    const other = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }), ip: "198.51.100.1" }), e, NOW);
    expect(other.status).toBe(200);
    const later = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) }), e, NOW + 3_600_001);
    expect(later.status).toBe(200);
  });

  it("登录后能读邮件（新的在前）和通知", async () => {
    const { db, emails, notices } = fakeDb();
    emails.push({ id: "a", received_at: "2026-10-10T00:00:00.000Z", subject: "旧" }, { id: "b", received_at: "2026-10-11T00:00:00.000Z", subject: "新" });
    notices.push({ id: "n", kind: "gmail-forwarding", received_at: "2026-10-11T00:00:00.000Z", subject: "Gmail", body: "验证码：1" });
    const e = env(db);
    const cookie = await login(e);
    const res = await handleApi(req("/api/emails", { cookie }), e, NOW);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emails: { id: string }[] };
    expect(body.emails.map((x) => x.id)).toEqual(["b", "a"]);
    const n = (await (await handleApi(req("/api/notices", { cookie }), e, NOW)).json()) as { notices: unknown[] };
    expect(n.notices).toHaveLength(1);
  });

  it("手动操作：存进去再读出来；形状不对、太大都拒绝", async () => {
    const { db } = fakeDb();
    const e = env(db);
    const cookie = await login(e);
    const empty = (await (await handleApi(req("/api/edits", { cookie }), e, NOW)).json()) as { edits: unknown };
    expect(empty.edits).toBeNull();

    const edits = { version: 1, decisions: {}, companyZones: { 云帆: "Asia/Shanghai" } };
    const put = await handleApi(req("/api/edits", { method: "PUT", cookie, body: JSON.stringify(edits) }), e, NOW);
    expect(put.status).toBe(200);
    const got = (await (await handleApi(req("/api/edits", { cookie }), e, NOW)).json()) as { edits: unknown };
    expect(got.edits).toEqual(edits);

    expect((await handleApi(req("/api/edits", { method: "PUT", cookie, body: "{坏" }), e, NOW)).status).toBe(400);
    expect((await handleApi(req("/api/edits", { method: "PUT", cookie, body: JSON.stringify({ version: 2 }) }), e, NOW)).status).toBe(400);
    const huge = JSON.stringify({ version: 1, pad: "x".repeat(600 * 1024) });
    expect((await handleApi(req("/api/edits", { method: "PUT", cookie, body: huge }), e, NOW)).status).toBe(413);
  });

  it("退出：清掉 cookie；改密码后旧 cookie 失效", async () => {
    const { db } = fakeDb();
    const e = env(db);
    const cookie = await login(e);
    const out = await handleApi(req("/api/logout", { method: "POST", cookie }), e, NOW);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    const changed = await handleApi(req("/api/session", { cookie }), env(db, { BOARD_PASSWORD: "new-password" }), NOW);
    expect(changed.status).toBe(401);
  });

  it("登录状态里带上允许转信的地址（「邮件」页教程用）", async () => {
    const e = env(fakeDb().db, { ALLOWED_FORWARDERS: "Me@Gmail.com, other@example.com" });
    const cookie = await login(e);
    const body = (await (await handleApi(req("/api/session", { cookie }), e, NOW)).json()) as { forwarders: string[] };
    expect(body.forwarders).toEqual(["me@gmail.com", "other@example.com"]);
  });

  it("不存在的接口：404", async () => {
    const e = env();
    const cookie = await login(e);
    expect((await handleApi(req("/api/nope", { cookie }), e, NOW)).status).toBe(404);
  });

  it("导入接口：要登录；缺发信时刻返回 400；重复返回 duplicate", async () => {
    const { db, emails } = fakeDb();
    const e = env(db);
    const item = { from: "HR <hr@x.example>", subject: "面试邀请", body: "面试时间：10月20日 14:00（北京时间）", receivedAtUtc: "2026-10-01T00:00:00Z" };
    expect((await handleApi(req("/api/import", { method: "POST", body: JSON.stringify(item) }), e, NOW)).status).toBe(401);
    const cookie = await login(e);
    const ok = await handleApi(req("/api/import", { method: "POST", cookie, body: JSON.stringify(item) }), e, NOW);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ kind: "stored", status: "parsed" });
    const again = await handleApi(req("/api/import", { method: "POST", cookie, body: JSON.stringify(item) }), e, NOW);
    expect(await again.json()).toEqual({ kind: "duplicate" });
    const bad = await handleApi(req("/api/import", { method: "POST", cookie, body: JSON.stringify({ ...item, receivedAtUtc: "" }) }), e, NOW);
    expect(bad.status).toBe(400);
    expect(emails).toHaveLength(1);
  });

  it("彻底删除：只能删回收站里的信", async () => {
    const { db, emails } = fakeDb();
    emails.push({ id: "a", received_at: "2026-10-10T00:00:00.000Z" }, { id: "b", received_at: "2026-10-11T00:00:00.000Z" });
    const e = env(db);
    const cookie = await login(e);
    expect((await handleApi(req("/api/emails/a", { method: "DELETE" }), e, NOW)).status).toBe(401);
    expect((await handleApi(req("/api/emails/a", { method: "DELETE", cookie }), e, NOW)).status).toBe(409);
    await handleApi(req("/api/edits", { method: "PUT", cookie, body: JSON.stringify({ version: 1, deletedEmails: { a: 1 } }) }), e, NOW);
    expect((await handleApi(req("/api/emails/a", { method: "DELETE", cookie }), e, NOW)).status).toBe(200);
    expect(emails.map((x) => x.id)).toEqual(["b"]);
  });
});
