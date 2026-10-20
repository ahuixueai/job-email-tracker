import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api";
import { pruneSecurityLogs } from "../src/privacy";
import { putUserSetting } from "../src/store";
import { insertEmail, member, owner, setup as baseSetup } from "./helpers";

const PASSWORD = "pw-for-tests";
const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 86_400_000;

const req = (path: string, init: { method?: string; body?: string; cookie?: string } = {}) =>
  new Request(`https://board.example${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}), "cf-connecting-ip": "203.0.113.9" },
    ...(init.body !== undefined ? { body: init.body } : {}),
  });

async function setup() {
  const t = baseSetup({ BOARD_PASSWORD: PASSWORD });
  const env = t.e;
  const res = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) }), env, NOW);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const me = await owner(env);
  await insertEmail(env, me.id, { id: "e1" });
  await putUserSetting(env, me.id, "resume", '{"text":"简历"}', "x");
  // 另一个人的数据：删我的时候不能动
  const other = await member(env, "other@x.example");
  await insertEmail(env, other.id, { id: "e2" });
  await putUserSetting(env, other.id, "resume", '{"text":"别人的简历"}', "x");
  return { ...t, env, cookie, me, other };
}

describe("删除我的账号和数据", () => {
  it("没手打确认语：不删", async () => {
    const { env, cookie, emails } = await setup();
    const res = await handleApi(req("/api/account/delete", { method: "POST", cookie, body: JSON.stringify({ confirm: "删除" }) }), env, NOW);
    expect(res.status).toBe(400);
    expect(emails()).toHaveLength(2);
  });

  it("没登录：不能删", async () => {
    const { env, emails } = await setup();
    const res = await handleApi(req("/api/account/delete", { method: "POST", body: JSON.stringify({ confirm: "删除全部数据" }) }), env, NOW);
    expect(res.status).toBe(401);
    expect(emails()).toHaveLength(2);
  });

  it("确认后：我的邮件、设置、简历、账号全部删掉并退出登录；别人的一行不动", async () => {
    const { env, cookie, emails, all, me, other } = await setup();
    const res = await handleApi(req("/api/account/delete", { method: "POST", cookie, body: JSON.stringify({ confirm: "删除全部数据" }) }), env, NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(emails(me.id)).toHaveLength(0);
    expect(all("SELECT * FROM user_settings WHERE user_id = ?", me.id)).toHaveLength(0);
    expect(all("SELECT * FROM users WHERE id = ?", me.id)).toHaveLength(0);
    expect(emails(other.id)).toHaveLength(1);
    expect(all("SELECT * FROM user_settings WHERE user_id = ?", other.id)).toHaveLength(1);
    expect(all("SELECT * FROM users WHERE id = ?", other.id)).toHaveLength(1);
    // 旧 cookie 也读不到任何东西了
    const after = await handleApi(req("/api/emails", { cookie }), env, NOW);
    expect(after.status).toBe(401);
  });
});

describe("定期清理登录记录", () => {
  it("IP 记录 2 天后删；验证码表一天没动的行删", async () => {
    const { env, exec, all } = await setup();
    exec("DELETE FROM login_sends");
    exec("DELETE FROM login_failures");
    exec("DELETE FROM login_codes");
    const iso = (ms: number) => new Date(ms).toISOString();
    exec("INSERT INTO login_sends (ip, at) VALUES (?, ?), (?, ?)", "1.1.1.1", iso(NOW - 3 * DAY), "2.2.2.2", iso(NOW - DAY));
    exec("INSERT INTO login_failures (ip, at) VALUES (?, ?)", "3.3.3.3", iso(NOW - 3 * DAY));
    const code = "INSERT INTO login_codes (email, last_sent_at, window_start, window_sends) VALUES (?, ?, ?, 1)";
    exec(code, "old@x.com", iso(NOW - 2 * DAY), iso(NOW));
    exec(code, "new@x.com", iso(NOW - 3_600_000), iso(NOW));
    await pruneSecurityLogs(env, NOW);
    expect(all<{ ip: string }>("SELECT ip FROM login_sends").map((r) => r.ip)).toEqual(["2.2.2.2"]);
    expect(all("SELECT * FROM login_failures")).toHaveLength(0);
    expect(all<{ email: string }>("SELECT email FROM login_codes").map((r) => r.email)).toEqual(["new@x.com"]);
  });
});
