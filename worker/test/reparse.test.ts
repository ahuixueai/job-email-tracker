import { describe, expect, it } from "vitest";
import { handleIncoming } from "../src/inbox.js";
import type { IncomingMail } from "../src/inbox.js";
import { BATCH, reparseBatch, RETRY_BATCH, retryModelBatch } from "../src/reparse.js";
import { ME, owner, ownerSetting, setup } from "./helpers.js";
const NOW = Date.parse("2026-10-13T04:00:00Z");

function mail(i: number, subject: string): IncomingMail {
  return {
    envelopeFrom: "bounce@x.example",
    envelopeTo: "jobs@my.example",
    headers: [{ key: "x-forwarded-for", value: `${ME} jobs@my.example` }],
    from: "星河科技 <hr@xinghe.example>",
    subject,
    text: "同学你好，流程包括笔试和面试。考试时间：10月20日 19:00（北京时间）",
    html: undefined,
    date: "Mon, 12 Oct 2026 11:00:00 +0800",
    messageId: `<m${i}@x>`,
  };
}

describe("按新规则重判已存的邮件", () => {
  it("分批做完；不调用模型；结论按现在的规则", async () => {
    const { e: env, emails, exec } = setup();
    let n = 0;
    for (let i = 0; i < BATCH + 3; i += 1) await handleIncoming(mail(i, `星河科技笔试通知 ${i}`), env, NOW, () => `id-${String(++n).padStart(3, "0")}`);
    // 假装有一封是旧规则判错的：把它的结论改成「面试」
    const first = emails()[0]!;
    const broken = JSON.parse(String(first.outcome));
    broken.event.eventType = "interview";
    exec("UPDATE emails SET outcome = ? WHERE id = ?", JSON.stringify(broken), first.id);
    const me = await owner(env);

    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    try {
      const one = await reparseBatch(env, me.id, null);
      expect(one.checked).toBe(BATCH);
      expect(one.changed).toBe(1);
      expect(one.next).toBe(`id-${String(BATCH).padStart(3, "0")}`);
      const two = await reparseBatch(env, me.id, one.next);
      expect(two.checked).toBe(3);
      expect(two.next).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
    expect(called).toBe(false);
    expect(JSON.parse(String(emails()[0]!.outcome)).event.eventType).toBe("assessment");
  });
});

describe("改了求职地之后重判", () => {
  it("原来没写时区、进了待确认的信，按新设置的求职地换算出时刻", async () => {
    const { e: env, emails } = setup();
    const noZone = { ...mail(1, "星河科技笔试通知"), text: "同学你好，\n笔试时间：2026-10-20 10:00-12:00\n请准时参加" };
    await handleIncoming(noZone, env, NOW, () => "id-001");
    expect(JSON.parse(String(emails()[0]!.outcome)).event.startUtc).toBeNull();

    await ownerSetting(env, "prefs", JSON.stringify({ version: 1, timeZones: { home: null, job: "Asia/Shanghai" } }));
    const r = await reparseBatch(env, (await owner(env)).id, null);
    expect(r.changed).toBe(1);
    const after = JSON.parse(String(emails()[0]!.outcome));
    expect(after.event.startUtc).toBe("2026-10-20T02:00:00.000Z");
    expect(after.trace.tz.source).toBe("jobRegion");
  });
});

describe("收信时模型没响应的信：重新调用模型", () => {
  const LLM = { LLM_API_KEY: "k", LLM_BASE_URL: "https://api.deepseek.com/v1", LLM_MODEL: "deepseek-v4-pro" };
  const reply = (companyRaw: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ companyRaw, roleRaw: null, locationRaw: null, timeText: null, eventTypeHint: null, notJobRelated: false }) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("只重做失败的那几封；成功后公司名补上、错误清掉；请求里关掉了思考模式", async () => {
    const { e: env, emails } = setup(LLM);
    const original = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    try {
      // 收信时模型挂了：两封只用了规则
      globalThis.fetch = (async () => new Response("busy", { status: 503 })) as typeof fetch;
      const plain = (i: number) => ({ ...mail(i, "面试提醒"), from: "某专员 <noreply@shmail.ibeisen.com>", text: "请准时参加面试。" });
      await handleIncoming(plain(1), env, NOW, () => "id-001");
      await handleIncoming(plain(2), env, NOW, () => "id-002");
      // 一封模型当时是好的，不该被重做
      globalThis.fetch = (async () => reply("云帆")) as typeof fetch;
      await handleIncoming(plain(3), env, NOW, () => "id-003");
      expect(emails().map((e) => String(e.error ?? "").startsWith("模型调用失败"))).toEqual([true, true, false]);

      globalThis.fetch = (async (_url: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body) as Record<string, unknown>);
        return reply("星河科技");
      }) as unknown as typeof fetch;
      const r = await retryModelBatch(env, await owner(env), null, NOW);
      expect(r).toMatchObject({ checked: 2, changed: 2, failed: 0, next: null });
      expect(bodies).toHaveLength(2);
      expect(bodies[0]!.thinking).toEqual({ type: "disabled" });
      for (const row of emails().slice(0, 2)) {
        expect(row.error).toBeNull();
        expect(row.model).toBe("deepseek-v4-pro");
        expect(JSON.parse(String(row.outcome)).event.company).toBe("星河"); // 认不出的公司名按原样清洗（去掉「科技」）
      }
      expect(JSON.parse(String(emails()[2]!.outcome)).event.company).toBe("云帆");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("这次还失败：照旧保留规则的结论，记下新的原因；分批往下走", async () => {
    const { e: env, emails } = setup(LLM);
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response("busy", { status: 503 })) as typeof fetch;
      for (let i = 1; i <= RETRY_BATCH + 1; i += 1) await handleIncoming(mail(i, `星河科技笔试通知 ${i}`), env, NOW, () => `id-00${i}`);
      const one = await retryModelBatch(env, await owner(env), null, NOW);
      expect(one).toMatchObject({ checked: RETRY_BATCH, failed: RETRY_BATCH, next: `id-00${RETRY_BATCH}` });
      const two = await retryModelBatch(env, await owner(env), one.next, NOW);
      expect(two).toMatchObject({ checked: 1, next: null });
      expect(String(emails()[0]!.error)).toContain("HTTP 503");
    } finally {
      globalThis.fetch = original;
    }
  });
});
