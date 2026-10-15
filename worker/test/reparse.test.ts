import { describe, expect, it } from "vitest";
import { handleIncoming } from "../src/inbox.js";
import type { IncomingMail } from "../src/inbox.js";
import { BATCH, reparseBatch } from "../src/reparse.js";
import type { Env } from "../src/types.js";
import { fakeDb } from "./fakeDb.js";

const ME = "me@gmail.example";
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
    const { db, emails } = fakeDb();
    const env: Env = { DB: db, ALLOWED_FORWARDERS: ME };
    let n = 0;
    for (let i = 0; i < BATCH + 3; i += 1) await handleIncoming(mail(i, `星河科技笔试通知 ${i}`), env, NOW, () => `id-${String(++n).padStart(3, "0")}`);
    // 假装有一封是旧规则判错的：把它的结论改成「面试」
    const first = emails[0]!;
    const broken = JSON.parse(String(first.outcome));
    broken.event.eventType = "interview";
    first.outcome = JSON.stringify(broken);

    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    try {
      const one = await reparseBatch(env, null);
      expect(one.checked).toBe(BATCH);
      expect(one.changed).toBe(1);
      expect(one.next).toBe(`id-${String(BATCH).padStart(3, "0")}`);
      const two = await reparseBatch(env, one.next);
      expect(two.checked).toBe(3);
      expect(two.next).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
    expect(called).toBe(false);
    expect(JSON.parse(String(emails[0]!.outcome)).event.eventType).toBe("assessment");
  });
});
