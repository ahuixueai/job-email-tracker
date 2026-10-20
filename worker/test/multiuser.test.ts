import { describe, expect, it } from "vitest";
import { AI_OFF_NOTE, AI_QUOTA_NOTE } from "../src/ai.js";
import { ensureOwner } from "../src/accounts.js";
import { handleApi } from "../src/api.js";
import type { ApiDeps } from "../src/api.js";
import { handleIncoming } from "../src/inbox.js";
import type { IncomingMail } from "../src/inbox.js";
import { findProblems } from "../src/monitor.js";
import type { Env } from "../src/types.js";
import { DOMAIN, insertEmail, ME, member, owner, ownerSetting, setup as baseSetup } from "./helpers.js";
import { testDb } from "./testDb.js";

/**
 * 多人版：每个人的信、设置、AI 用量各管各的；收信地址认人；作者那条老路（jobs@）不变。
 */

const NOW = Date.parse("2026-10-15T12:00:00Z");
const LLM = { LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "m" };
let counter = 0;
const newId = () => `mid-${++counter}`;

function mail(to: string, forwarder: string, over: Partial<IncomingMail> = {}): IncomingMail {
  return {
    envelopeFrom: "bounce@xinghe.example",
    envelopeTo: to,
    headers: [{ key: "x-forwarded-for", value: `${forwarder} ${to}` }],
    from: "星河科技校园招聘 <campus@xinghe.example>",
    subject: "【星河科技】在线笔试通知",
    text: "同学你好，\n考试时间：10月20日 19:00-20:40（北京时间）",
    html: undefined,
    date: "Mon, 12 Oct 2026 11:00:00 +0800",
    messageId: "<m1@xinghe.example>",
    ...over,
  };
}

function setup(over: Partial<Env> = {}) {
  const t = baseSetup({ BOARD_PASSWORD: "pw", SESSION_SECRET: "sess", TURNSTILE_SECRET: "ts", ...over });
  const sent: { to: string; code: string }[] = [];
  const deps: ApiDeps = {
    checkTurnstile: (token) => Promise.resolve(token === "human"),
    sendCode: (to, code) => {
      sent.push({ to, code });
      return Promise.resolve();
    },
  };
  const call = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
    handleApi(
      new Request(`https://board.example${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: { "cf-connecting-ip": "203.0.113.7", ...(init.cookie ? { cookie: init.cookie } : {}) },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
      t.e,
      NOW,
      deps,
    );
  /** 用验证码登录（新邮箱就注册），返回 cookie。 */
  const login = async (email: string): Promise<string> => {
    await call("/api/auth/code", { body: { email, turnstile: "human" } });
    const code = sent.filter((s) => s.to === email).at(-1)?.code;
    const res = await call("/api/auth/verify", { body: { email, code } });
    expect(res.status).toBe(200);
    return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  };
  return { ...t, call, login };
}

type Session = { user: { role: string }; inbox: string; forwarders: string[]; extraForwarders: string[]; ai: { enabled: boolean; usedToday: number; dailyLimit: number | null } };

describe("收信地址认人", () => {
  it("jobs@ 进作者名下；u-口令@ 进对应那个人名下；两边互不可见", async () => {
    const { e, emails } = setup();
    const me = await owner(e);
    const amy = await member(e, "amy@school.example");
    expect(await handleIncoming(mail(`jobs@${DOMAIN}`, ME), e, NOW, newId)).toEqual({ kind: "stored", status: "parsed" });
    // 同一封群发信，两个人都转发：各存各的
    expect(await handleIncoming(mail(`u-${amy.inbox_token}@${DOMAIN}`, "amy@school.example"), e, NOW, newId)).toEqual({ kind: "stored", status: "parsed" });
    expect(emails(me.id)).toHaveLength(1);
    expect(emails(amy.id)).toHaveLength(1);
  });

  it("不存在的收信地址、别的域名：拒收", async () => {
    const { e, emails } = setup();
    await member(e, "amy@school.example");
    expect((await handleIncoming(mail(`u-aaaaaaaaaa@${DOMAIN}`, "amy@school.example"), e, NOW, newId)).kind).toBe("rejected");
    expect((await handleIncoming(mail(`hello@${DOMAIN}`, ME), e, NOW, newId)).kind).toBe("rejected");
    expect((await handleIncoming(mail("jobs@other.example", ME), e, NOW, newId)).kind).toBe("rejected");
    expect(emails()).toHaveLength(0);
  });

  it("只认这个人自己的转发邮箱：别人用他的地址、他用作者的地址，都拒收", async () => {
    const { e, emails } = setup();
    const amy = await member(e, "amy@school.example");
    expect((await handleIncoming(mail(`u-${amy.inbox_token}@${DOMAIN}`, ME), e, NOW, newId)).kind).toBe("rejected");
    expect((await handleIncoming(mail(`jobs@${DOMAIN}`, "amy@school.example"), e, NOW, newId)).kind).toBe("rejected");
    expect(emails()).toHaveLength(0);
  });

  it("加了额外的转发邮箱（比如登录用学校邮箱、转信用 Gmail）：就收", async () => {
    const { e, emails, call, login } = setup();
    const cookie = await login("amy@school.example");
    const s1 = (await (await call("/api/session", { cookie })).json()) as Session;
    expect(s1.user.role).toBe("member");
    expect(s1.forwarders).toEqual(["amy@school.example"]); // 作者的 ALLOWED_FORWARDERS 不会带过来
    const gmail = "amy.w@gmail.example";
    expect((await handleIncoming(mail(s1.inbox, gmail), e, NOW, newId)).kind).toBe("rejected");

    expect((await call("/api/account/forwarders", { method: "PUT", cookie, body: { list: ["不是邮箱"] } })).status).toBe(400);
    expect((await call("/api/account/forwarders", { method: "PUT", cookie, body: { list: ["a@x.example", "b@x.example", "c@x.example", "d@x.example"] } })).status).toBe(400);
    const put = await call("/api/account/forwarders", { method: "PUT", cookie, body: { list: [" Amy.W@Gmail.example "] } });
    expect(await put.json()).toEqual({ ok: true, extraForwarders: [gmail] });
    expect((await handleIncoming(mail(s1.inbox, gmail), e, NOW, newId)).kind).toBe("stored");
    expect(emails()).toHaveLength(1);
  });
});

describe("别的邮箱（QQ 等）开通转发时的确认信", () => {
  it("标题像转发确认信：存成这个人的提醒（不解析）；普通陌生信照样拒收，日志里不记标题", async () => {
    const { e, emails, notices } = setup();
    const amy = await member(e, "amy@qq.example");
    const to = `u-${amy.inbox_token}@${DOMAIN}`;
    const logs: string[] = [];
    const original = console.log;
    console.log = (line: string) => logs.push(line);
    try {
      const verify = await handleIncoming(
        mail(to, "x", { headers: [], envelopeFrom: "system@mail.qq.example", from: "QQ邮箱 <system@mail.qq.example>", subject: "QQ邮箱自动转发验证", text: "请点击链接确认：https://mail.qq.example/verify?x=1" }),
        e,
        NOW,
        newId,
      );
      expect(verify).toEqual({ kind: "notice" });
      const stranger = await handleIncoming(mail(to, "x", { headers: [], envelopeFrom: "a@spam.example", from: "a@spam.example", subject: "私人标题" }), e, NOW, newId);
      expect(stranger.kind).toBe("rejected");
    } finally {
      console.log = original;
    }
    expect(emails()).toHaveLength(0);
    expect(notices().map((n) => [n.user_id, n.kind])).toEqual([[amy.id, "forward-verify"]]);
    expect(String(notices()[0]!.body)).toContain("https://mail.qq.example/verify?x=1");
    const diags = logs.map((l) => JSON.parse(l).inboxDiag);
    expect(diags[0]).toMatchObject({ envelopeFromDomain: "mail.qq.example", hasXForwardedFor: false, subject: "QQ邮箱自动转发验证" });
    expect(diags[1]).toMatchObject({ envelopeFromDomain: "spam.example" });
    expect(diags[1].subject).toBeUndefined();
    expect(logs.join("")).not.toContain("私人标题");
  });
});

describe("QQ 邮箱的转发确认信（以你自己的 QQ 地址发来）", () => {
  it("存成「转发确认」提醒，按钮地址保留；招聘信里写「请勿转发」的不受影响", async () => {
    const { e, emails, notices } = setup();
    const amy = await member(e, "amy@qq.example");
    const to = `u-${amy.inbox_token}@${DOMAIN}`;
    const qq = await handleIncoming(
      mail(to, "amy@qq.example", {
        headers: [],
        envelopeFrom: "amy@qq.example",
        from: "amy <amy@qq.example>",
        subject: "QQ邮箱自动转发验证邮件",
        text: "亲爱的用户，你好！\n接受转发\n如果你误触导致该转发生效，请点击取消接受转发",
        html: '<p>亲爱的用户，你好！</p><a href="https://wx.mail.qq.example/accept?k=1&amp;t=2">接受转发</a><p>请点击<a href="https://wx.mail.qq.example/cancel">取消接受转发</a></p>',
        messageId: "<v1@qq>",
      }),
      e,
      NOW,
      newId,
    );
    expect(qq).toEqual({ kind: "notice" });
    expect(notices().map((n) => n.kind)).toEqual(["forward-verify"]);
    expect(String(notices()[0]!.body)).toContain("接受转发（https://wx.mail.qq.example/accept?k=1&t=2）");
    const job = await handleIncoming(mail(to, "amy@qq.example", { subject: "请确认面试时间（请勿转发）", messageId: "<j1@x>" }), e, NOW, newId);
    expect(job).toEqual({ kind: "stored", status: "parsed" });
    expect(emails()).toHaveLength(1);
  });
});

describe("从 QQ 邮箱手动转发", () => {
  it("一封：认出「原始邮件」下面的原发件人和主题，正常解析，不当成自己写的信", async () => {
    const { e, emails } = setup();
    const amy = await member(e, "amy@qq.example");
    const to = `u-${amy.inbox_token}@${DOMAIN}`;
    const r = await handleIncoming(
      mail(to, "amy@qq.example", {
        headers: [],
        envelopeFrom: "amy@qq.example",
        from: "amy <amy@qq.example>",
        subject: "转发：【星河科技】在线笔试通知",
        text: "amy amy@qq.example\n\n原始邮件\n\n发件人： 星河科技校园招聘 <campus@xinghe.example>\n发件时间： 2026年10月12日 11:00\n收件人： amy <amy@qq.example>\n主题： 【星河科技】在线笔试通知\n\n同学你好，\n考试时间：10月20日 19:00-20:40（北京时间）",
        messageId: "<f1@qq>",
      }),
      e,
      NOW,
      newId,
    );
    expect(r).toEqual({ kind: "stored", status: "parsed" });
    const row = emails(amy.id)[0]!;
    expect(row.from_addr).toBe("星河科技校园招聘 <campus@xinghe.example>");
    expect(row.subject).toBe("【星河科技】在线笔试通知");
    expect(JSON.parse(String(row.outcome)).event.eventType).toBe("assessment");
  });

  it("一次转发好几封（原信夹在附件里）：拆开，每封按原信处理，收信时刻用原信的时间", async () => {
    const { e, emails } = setup();
    const amy = await member(e, "amy@qq.example");
    const to = `u-${amy.inbox_token}@${DOMAIN}`;
    const inner = (n: number, date: string) => ({
      envelopeFrom: "",
      envelopeTo: "",
      headers: [],
      from: `星河科技校园招聘 <campus${n}@xinghe.example>`,
      subject: `【星河科技】在线笔试通知 ${n}`,
      text: "同学你好，\n考试时间：10月20日 19:00-20:40（北京时间）",
      html: undefined,
      date,
      messageId: `<orig-${n}@xinghe.example>`,
    });
    const r = await handleIncoming(
      mail(to, "amy@qq.example", {
        headers: [],
        envelopeFrom: "amy@qq.example",
        from: "amy <amy@qq.example>",
        subject: "",
        text: "",
        messageId: "<wrap@qq>",
        attached: [inner(1, "Mon, 12 Oct 2026 11:00:00 +0800"), inner(2, "Tue, 13 Oct 2026 09:00:00 +0800")],
      }),
      e,
      NOW,
      newId,
    );
    expect(r).toEqual({ kind: "split", results: [{ kind: "stored", status: "parsed" }, { kind: "stored", status: "parsed" }] });
    const rows = emails(amy.id);
    expect(rows.map((x) => [x.subject, x.received_at, x.via])).toEqual([
      ["【星河科技】在线笔试通知 1", "2026-10-12T03:00:00.000Z", "manual"],
      ["【星河科技】在线笔试通知 2", "2026-10-13T01:00:00.000Z", "manual"],
    ]);
  });
});

describe("接口按人隔离", () => {
  it("看不到、删不掉、改不到别人的；监控只有作者能看", async () => {
    const { e, call, login, emails } = setup();
    const me = await owner(e);
    await insertEmail(e, me.id, { id: "owner-mail", subject: "作者的信" });
    await ownerSetting(e, "edits", JSON.stringify({ version: 1, deletedEmails: { "owner-mail": 1 } }));

    const cookie = await login("amy@school.example");
    const list = (await (await call("/api/emails", { cookie })).json()) as { emails: unknown[] };
    expect(list.emails).toEqual([]);
    expect(await (await call("/api/edits", { cookie })).json()).toEqual({ edits: null });
    await call("/api/emails/owner-mail", { method: "DELETE", cookie });
    expect(emails(me.id)).toHaveLength(1);
    expect((await call("/api/monitor", { cookie })).status).toBe(403);

    // 删提醒也只能删自己的
    await e.DB.prepare("INSERT INTO notices (id, user_id, kind, received_at, subject, body) VALUES ('owner-n', ?, 'gmail-forwarding', 'x', 's', 'b')").bind(me.id).run();
    await call("/api/notices/owner-n", { method: "DELETE", cookie });
    expect(await e.DB.prepare("SELECT id FROM notices WHERE id = 'owner-n'").first()).not.toBeNull();
    const amyId = ((await e.DB.prepare("SELECT id FROM users WHERE email = 'amy@school.example'").first()) as { id: string }).id;
    await e.DB.prepare("INSERT INTO notices (id, user_id, kind, received_at, subject, body) VALUES ('amy-n', ?, 'forward-verify', 'x', 's', 'b')").bind(amyId).run();
    expect((await call("/api/notices/amy-n", { method: "DELETE", cookie })).status).toBe(200);
    expect(await e.DB.prepare("SELECT id FROM notices WHERE id = 'amy-n'").first()).toBeNull();
    await call("/api/edits", { method: "PUT", cookie, body: { version: 1, deletedEmails: {} } });
    const ownerEdits = e.DB.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'edits'").bind(me.id);
    expect(JSON.parse(((await ownerEdits.first()) as { value: string }).value).deletedEmails).toEqual({ "owner-mail": 1 });
  });
});

describe("AI 开关与每日额度", () => {
  const modelReply = () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ companyRaw: "星河科技", roleRaw: null, locationRaw: null, timeText: "10月20日 19:00", eventTypeHint: "assessment", notJobRelated: false }) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  async function withModel<T>(fn: (calls: () => number) => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => {
      n += 1;
      return modelReply();
    }) as typeof fetch;
    try {
      return await fn(() => n);
    } finally {
      globalThis.fetch = original;
    }
  }

  it("关掉 AI：只用规则，记下原因；不算模型失败，监控不报警", async () => {
    await withModel(async (calls) => {
      const { e, emails, call, login } = setup(LLM);
      const cookie = await login("amy@school.example");
      expect((await call("/api/account/ai", { method: "PUT", cookie, body: { enabled: "no" } })).status).toBe(400);
      expect((await call("/api/account/ai", { method: "PUT", cookie, body: { enabled: false } })).status).toBe(200);
      const s = (await (await call("/api/session", { cookie })).json()) as Session;
      expect(s.ai.enabled).toBe(false);
      for (const id of ["<a@x>", "<b@x>"]) await handleIncoming(mail(s.inbox, "amy@school.example", { messageId: id }), e, NOW, newId);
      expect(calls()).toBe(0);
      expect(emails().map((r) => [r.model, r.error])).toEqual([
        [null, AI_OFF_NOTE],
        [null, AI_OFF_NOTE],
      ]);
      expect(await findProblems(e, NOW)).toEqual([]);
    });
  });

  it("额度用完：当天之后的信只用规则；作者不限；第二天恢复", async () => {
    await withModel(async (calls) => {
      const { e, emails, call, login } = setup({ ...LLM, AI_DAILY_LIMIT: "1" });
      const cookie = await login("amy@school.example");
      const s = (await (await call("/api/session", { cookie })).json()) as Session;
      expect(s.ai).toEqual({ enabled: true, usedToday: 0, dailyLimit: 1 });
      await handleIncoming(mail(s.inbox, "amy@school.example", { messageId: "<a@x>" }), e, NOW, newId);
      await handleIncoming(mail(s.inbox, "amy@school.example", { messageId: "<b@x>" }), e, NOW, newId);
      expect(emails().map((r) => r.error)).toEqual([null, AI_QUOTA_NOTE]);
      expect(((await (await call("/api/session", { cookie })).json()) as Session).ai.usedToday).toBe(1);
      await handleIncoming(mail(s.inbox, "amy@school.example", { messageId: "<c@x>" }), e, NOW + 86_400_000, newId);
      expect(emails().at(-1)!.error).toBeNull();

      for (const id of ["<o1@x>", "<o2@x>", "<o3@x>"]) await handleIncoming(mail(`jobs@${DOMAIN}`, ME, { messageId: id }), e, NOW, newId);
      expect(emails((await owner(e)).id).map((r) => r.model)).toEqual(["m", "m", "m"]);
      expect(calls()).toBe(5);
    });
  });
});

describe("迁移脚本 0004：老数据归到作者名下", () => {
  const legacy = (t: ReturnType<typeof testDb>) => {
    t.exec(
      "INSERT INTO emails (id, message_id, received_at, stored_at, via, from_addr, subject, body, status) VALUES ('old-1', '<old@x>', 'r', 's', 'auto', 'a', 'b', 'c', 'parsed')",
    );
    t.exec("INSERT INTO notices (id, kind, received_at, subject, body) VALUES ('n1', 'gmail-forwarding', 'r', 's', 'b')");
    t.exec("INSERT INTO settings (key, value, updated_at) VALUES ('edits', '{\"version\":1}', 'x'), ('monitor', '{}', 'x')");
  };

  it("作者账号已存在：迁移时直接归过去；系统设置（monitor）留在原处", () => {
    const t = testDb(3);
    t.exec("INSERT INTO users (id, email, role, calendar_token, created_at) VALUES ('u-owner', 'owner@my.example', 'owner', 'tok', 'x')");
    legacy(t);
    t.migrate(3);
    expect(t.emails().map((r) => [r.id, r.user_id])).toEqual([["old-1", "u-owner"]]);
    expect(t.all("SELECT user_id FROM notices")).toEqual([{ user_id: "u-owner" }]);
    expect(t.all("SELECT user_id, key FROM user_settings")).toEqual([{ user_id: "u-owner", key: "edits" }]);
    expect(t.all("SELECT key FROM settings")).toEqual([{ key: "monitor" }]);
    expect(t.all("SELECT forwarders, ai_enabled, inbox_token FROM users")).toEqual([{ forwarders: "", ai_enabled: 1, inbox_token: null }]);
  });

  it("作者账号还没建：先挂空，作者第一次出现时认领，并拿到收信口令", async () => {
    const t = testDb(3);
    legacy(t);
    t.migrate(3);
    expect(t.emails()[0]!.user_id).toBe("");
    const me = await ensureOwner({ DB: t.db, OWNER_EMAIL: "owner@my.example" }, NOW);
    expect(me?.inbox_token).toMatch(/^[a-z0-9]{10}$/);
    expect(t.emails()[0]!.user_id).toBe(me!.id);
    expect(t.all("SELECT user_id FROM notices")).toEqual([{ user_id: me!.id }]);
    expect(t.all("SELECT user_id, key FROM user_settings")).toEqual([{ user_id: me!.id, key: "edits" }]);
    expect(t.all("SELECT key FROM settings")).toEqual([{ key: "monitor" }]);
  });
});
