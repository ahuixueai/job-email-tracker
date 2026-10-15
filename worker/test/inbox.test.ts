import { describe, expect, it } from "vitest";
import { handleIncoming, importEmail } from "../src/inbox.js";
import type { IncomingMail } from "../src/inbox.js";
import type { D1Database, Env } from "../src/types.js";
import { fakeDb } from "./fakeDb.js";

const ME = "me@gmail.example";
const NOW = Date.parse("2026-10-12T04:00:00Z");
let counter = 0;
const newId = () => `id-${++counter}`;

function mail(over: Partial<IncomingMail> = {}): IncomingMail {
  return {
    envelopeFrom: "bounce@xinghe.example",
    envelopeTo: "jobs@my.example",
    headers: [{ key: "x-forwarded-for", value: `${ME} jobs@my.example` }],
    from: "星河科技校园招聘 <campus@xinghe.example>",
    subject: "【星河科技】在线笔试通知",
    text: "同学你好，\n考试时间：10月20日 19:00-20:40（北京时间）\n考试码：XHKJ-7Q4M",
    html: undefined,
    date: "Mon, 12 Oct 2026 11:00:00 +0800",
    messageId: "<m1@xinghe.example>",
    ...over,
  };
}

function env(db: D1Database, over: Partial<Env> = {}): Env {
  return { DB: db, ALLOWED_FORWARDERS: ME, ...over };
}

describe("处理一封转发来的信", () => {
  it("自动转发的笔试通知：只用规则也能存下完整结论", async () => {
    const { db, emails } = fakeDb();
    const result = await handleIncoming(mail(), env(db), NOW, newId);
    expect(result).toEqual({ kind: "stored", status: "parsed" });
    expect(emails).toHaveLength(1);
    const row = emails[0]!;
    expect(row.via).toBe("auto");
    expect(row.received_at).toBe("2026-10-12T03:00:00.000Z");
    expect(row.model).toBeNull();
    expect(row.error).toBeNull();
    const outcome = JSON.parse(String(row.outcome));
    expect(outcome.event.eventType).toBe("assessment");
    expect(outcome.event.dueType).toBe("fixed_start");
    expect(outcome.event.startUtc).toBe("2026-10-20T11:00:00.000Z");
    expect(outcome.trace.action.credentials[0].value).toBe("XHKJ-7Q4M");
  });

  it("同一封信转发两次只存一次", async () => {
    const { db, emails } = fakeDb();
    await handleIncoming(mail(), env(db), NOW, newId);
    expect(await handleIncoming(mail(), env(db), NOW, newId)).toEqual({ kind: "duplicate" });
    expect(emails).toHaveLength(1);
  });

  it("陌生人发来的信：拒收，不存，不调用模型", async () => {
    const { db, emails } = fakeDb();
    let called = false;
    const result = await handleIncoming(
      mail({ headers: [], envelopeFrom: "x@spam.example", from: "x@spam.example" }),
      env(db, { LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "m" }),
      NOW,
      () => {
        called = true;
        return "never";
      },
    );
    expect(result.kind).toBe("rejected");
    expect(emails).toHaveLength(0);
    expect(called).toBe(false);
  });

  it("手动转发：拆出原信的发件人和主题再解析", async () => {
    const { db, emails } = fakeDb();
    const body = [
      "",
      "---------- Forwarded message ---------",
      "From: 星河科技校园招聘 <campus@xinghe.example>",
      "Date: Mon, Oct 12, 2026 at 11:00 AM",
      "Subject: 【星河科技】在线笔试通知",
      "To: <me@gmail.example>",
      "",
      "考试时间：10月20日 19:00-20:40（北京时间）",
    ].join("\n");
    await handleIncoming(mail({ headers: [], envelopeFrom: ME, from: `Me <${ME}>`, subject: "Fwd: 【星河科技】在线笔试通知", text: body }), env(db), NOW, newId);
    const row = emails[0]!;
    expect(row.via).toBe("manual");
    expect(row.from_addr).toBe("星河科技校园招聘 <campus@xinghe.example>");
    expect(row.subject).toBe("【星河科技】在线笔试通知");
    expect(JSON.parse(String(row.outcome)).event.dueType).toBe("fixed_start");
  });

  it("验证码邮件：预筛丢弃，但仍然存下来可查", async () => {
    const { db, emails } = fakeDb();
    const result = await handleIncoming(mail({ subject: "您的验证码", text: "验证码 123456，5 分钟内有效", messageId: "<v@x>" }), env(db), NOW, newId);
    expect(result).toEqual({ kind: "stored", status: "dropped" });
    expect(emails[0]!.status).toBe("dropped");
  });

  it("Gmail 转发验证信：存成通知，带上验证码，不当成求职邮件", async () => {
    const { db, emails, notices } = fakeDb();
    const result = await handleIncoming(
      mail({ envelopeFrom: "forwarding-noreply@google.com", from: "Gmail Team <forwarding-noreply@google.com>", headers: [], subject: "(#123) Gmail Forwarding Confirmation", text: "Confirmation code: 123456789\nTo allow ...", messageId: "<g@google>" }),
      env(db),
      NOW,
      newId,
    );
    expect(result).toEqual({ kind: "notice" });
    expect(emails).toHaveLength(0);
    expect(String(notices[0]!.body)).toContain("验证码：123456789");
  });

  it("配置了模型：用模型摘的公司名；模型失败时退回规则并记下原因", async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ companyRaw: "星河科技", roleRaw: null, locationRaw: null, timeText: "考试时间：10月20日 19:00-20:40（北京时间）", eventTypeHint: "assessment", notJobRelated: false }) } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;
      const ok = fakeDb();
      await handleIncoming(mail(), env(ok.db, { LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "m" }), NOW, newId);
      expect(ok.emails[0]!.model).toBe("m");
      expect(JSON.parse(String(ok.emails[0]!.outcome)).trace.extraction.companyRaw).toBe("星河科技");

      globalThis.fetch = (async () => new Response("no", { status: 401 })) as typeof fetch;
      const bad = fakeDb();
      const result = await handleIncoming(mail(), env(bad.db, { LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "m" }), NOW, newId);
      expect(result).toEqual({ kind: "stored", status: "parsed" });
      expect(bad.emails[0]!.model).toBeNull();
      expect(String(bad.emails[0]!.error)).toContain("HTTP 401");
      expect(String(bad.emails[0]!.error)).not.toContain("k\"");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("只有 HTML 的信也能解析；正文按上限截断", async () => {
    const { db, emails } = fakeDb();
    const html = `<html><head><style>.a{}</style></head><body><p>考试时间：10月20日 19:00（北京时间）</p><p>${"x".repeat(30_000)}</p></body></html>`;
    await handleIncoming(mail({ text: undefined, html, messageId: "<h@x>" }), env(db), NOW, newId);
    expect(String(emails[0]!.body).length).toBe(20_000);
    expect(String(emails[0]!.body)).not.toContain(".a{}");
  });

  it("你自己写的信（回复 HR 时抄送了收信地址）：存档为 self，不解析、不调模型", async () => {
    const { db, emails } = fakeDb();
    let called = false;
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        called = true;
        return new Response("{}", { status: 500 });
      }) as typeof fetch;
      const result = await handleIncoming(
        mail({
          headers: [],
          envelopeFrom: ME,
          from: `Me <${ME}>`,
          subject: "Re: 【星河科技】面试邀约",
          text: "您好，下周国内上午都可以。\n\nOn Mon, Oct 12, 2026 at 9:00 AM HR <hr@xinghe.example> wrote:\n> 请回复可面试时间（美国团队）",
          messageId: "<self@gmail>",
        }),
        env(db, { LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "m" }),
        NOW,
        newId,
      );
      expect(result).toEqual({ kind: "stored", status: "self" });
      expect(called).toBe(false);
      expect(emails[0]).toMatchObject({ via: "self", status: "self", outcome: null, model: null });
      expect(emails[0]!.subject).toBe("Re: 【星河科技】面试邀约");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("你在看板上确认过某公司的时区：之后这家公司的信按它换算", async () => {
    const text = "同学你好，\n笔试时间：2026-10-20 10:00-12:00\n请准时参加";
    const plain = fakeDb();
    await handleIncoming(mail({ text, messageId: "<z1@x>" }), env(plain.db), NOW, newId);
    const before = JSON.parse(String(plain.emails[0]!.outcome));
    expect(before.event.startUtc).toBeNull();
    const company = before.event.company as string;
    expect(company.length).toBeGreaterThan(0);

    const learned = fakeDb();
    learned.settings.set("edits", {
      value: JSON.stringify({ version: 1, companyZones: { [company]: "Asia/Shanghai" } }),
      updated_at: "2026-10-12T00:00:00.000Z",
    });
    await handleIncoming(mail({ text, messageId: "<z2@x>" }), env(learned.db), NOW, newId);
    const after = JSON.parse(String(learned.emails[0]!.outcome));
    expect(after.event.startUtc).toBe("2026-10-20T02:00:00.000Z");
    expect(after.event.sourceTimeZone).toBe("Asia/Shanghai");
    expect(after.trace.tz.source).toBe("ledger");
  });

  it("存的手动操作读坏了：当作没有时区线索，收信照常", async () => {
    const { db, settings, emails } = fakeDb();
    settings.set("edits", { value: "{坏的", updated_at: "x" });
    const result = await handleIncoming(mail({ messageId: "<bad@x>" }), env(db), NOW, newId);
    expect(result).toEqual({ kind: "stored", status: "parsed" });
    expect(emails).toHaveLength(1);
  });
});

describe("你标成广告的发件人", () => {
  it("收信时直接存成已丢弃，不调模型", async () => {
    const { db, emails, settings } = fakeDb();
    settings.set("edits", { value: JSON.stringify({ version: 1, blockedSenders: ["campus@xinghe.example"] }), updated_at: "x" });
    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    try {
      const result = await handleIncoming(mail({ messageId: "<b1@x>" }), env(db, { LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "m" }), NOW, newId);
      expect(result).toEqual({ kind: "stored", status: "dropped" });
    } finally {
      globalThis.fetch = original;
    }
    expect(called).toBe(false);
    expect(JSON.parse(String(emails[0]!.outcome)).reason).toContain("campus@xinghe.example");
  });
});

describe("导入旧邮件", () => {
  const OLD = {
    from: "星河科技校园招聘 <campus@xinghe.example>",
    subject: "【星河科技】在线笔试通知",
    body: "同学你好， 考试时间：10月20日 19:00-20:40（北京时间） 考试码：XHKJ-7Q4M",
    receivedAtUtc: "2026-09-01T03:00:00Z",
  };

  it("收信时刻用原信的时间；和收信走同一条解析路", async () => {
    const { db, emails } = fakeDb();
    const result = await importEmail(OLD, env(db), NOW, newId);
    expect(result).toEqual({ kind: "stored", status: "parsed" });
    const row = emails[0]!;
    expect(row.via).toBe("import");
    expect(row.received_at).toBe("2026-09-01T03:00:00.000Z");
    expect(String(row.message_id)).toMatch(/^import:[0-9a-f]{64}$/);
    // 原信在 9 月，「10月20日」按原信年份算
    expect(JSON.parse(String(row.outcome)).event.startUtc).toBe("2026-10-20T11:00:00.000Z");
  });

  it("同一封导入两次只存一次", async () => {
    const { db, emails } = fakeDb();
    await importEmail(OLD, env(db), NOW, newId);
    expect(await importEmail(OLD, env(db), NOW, newId)).toEqual({ kind: "duplicate" });
    expect(emails).toHaveLength(1);
  });

  it("没有原信时刻：不导入，不猜", async () => {
    const { db, emails } = fakeDb();
    const result = await importEmail({ ...OLD, receivedAtUtc: "" }, env(db), NOW, newId);
    expect(result.kind).toBe("invalid");
    expect(emails).toHaveLength(0);
  });

  it("你自己发的信：只存档", async () => {
    const { db, emails } = fakeDb();
    const result = await importEmail({ ...OLD, from: `Me <${ME}>`, subject: "Re: 面试时间" }, env(db), NOW, newId);
    expect(result).toEqual({ kind: "stored", status: "self" });
    expect(emails[0]!.outcome).toBeNull();
  });
});
