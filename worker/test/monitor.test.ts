import { describe, expect, it } from "vitest";
import { handleIncoming } from "../src/inbox.js";
import type { IncomingMail } from "../src/inbox.js";
import { findProblems, runMonitor } from "../src/monitor.js";
import type { Env, OutgoingEmail } from "../src/types.js";
import { ME, owner, setup as baseSetup } from "./helpers.js";

const OWNER = "owner@my.example";
const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-15T12:00:00Z");

function row(i: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `id-${i}`,
    message_id: `<m${i}@x>`,
    received_at: new Date(T0 - HOUR).toISOString(),
    stored_at: new Date(T0 - HOUR).toISOString(),
    via: "auto",
    from_addr: "hr@xinghe.example",
    subject: `通知 ${i}`,
    body: "",
    status: "parsed",
    outcome: null,
    model: "m",
    error: null,
    ...over,
  };
}

function setup() {
  const sent: OutgoingEmail[] = [];
  const t = baseSetup({
    LOGIN_FROM: "login@my.example",
    EMAIL: {
      send: async (m) => {
        sent.push(m);
        return { messageId: "x" };
      },
    },
  });
  const env: Env = t.e;
  /** 往作者名下塞一封信（直接写库）。 */
  const emails = {
    push: async (...rows: Record<string, unknown>[]) => {
      const me = await owner(env);
      for (const r of rows) {
        const cols = Object.keys({ ...r, user_id: me.id });
        const vals = Object.values({ ...r, user_id: me.id });
        t.exec(`INSERT INTO emails (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...vals);
      }
    },
  };
  return { emails, env, sent };
}

const failed = { model: null, error: "模型调用失败，已退回纯规则：模型调用超时（25000ms）" };

describe("收信监控", () => {
  it("一切正常：不发信", async () => {
    const { emails, env, sent } = setup();
    await emails.push(row(1), row(2), row(3));
    expect(await findProblems(env, T0)).toEqual([]);
    expect((await runMonitor(env, T0)).alerted).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("AI 失败多（≥ 2 封且 ≥ 30%）：发一封，写明原因和处理办法；标题不带求职字样", async () => {
    const { emails, env, sent } = setup();
    await emails.push(row(1, failed), row(2, failed), row(3), row(4));
    const r = await runMonitor(env, T0);
    expect(r.alerted).toEqual(["model"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(OWNER);
    expect(sent[0]!.from).toEqual({ email: "login@my.example", name: "准点监控" });
    expect(sent[0]!.subject).toBe("准点提醒：AI 解析失败多");
    expect(sent[0]!.subject).not.toMatch(/求职|招聘|面试|笔试/);
    expect(sent[0]!.text).toContain("4 封信里，有 2 封 AI 没响应");
    expect(sent[0]!.text).toContain("模型调用超时");
  });

  it("只失败 1 封、或比例很低：不打扰", async () => {
    const one = setup();
    await one.emails.push(row(1, failed), row(2));
    expect(await findProblems(one.env, T0)).toEqual([]);
    const low = setup();
    await low.emails.push(row(1, failed), row(2, failed), ...Array.from({ length: 8 }, (_, i) => row(10 + i)));
    expect(await findProblems(low.env, T0)).toEqual([]);
  });

  it("24 小时前的失败不算", async () => {
    const { emails, env } = setup();
    const old = new Date(T0 - 30 * HOUR).toISOString();
    await emails.push(row(1, { ...failed, stored_at: old }), row(2, { ...failed, stored_at: old }), row(3));
    expect(await findProblems(env, T0)).toEqual([]);
  });

  it("3 天没收到信：提醒转发可能断了", async () => {
    const { emails, env } = setup();
    await emails.push(row(1, { stored_at: new Date(T0 - 80 * HOUR).toISOString() }));
    const problems = await findProblems(env, T0);
    expect(problems.map((p) => p.key)).toEqual(["quiet"]);
    expect(problems[0]!.text).toContain("3 天没收到新邮件");
  });

  it("有信整封处理出错：提醒", async () => {
    const { emails, env } = setup();
    await emails.push(row(1, { status: "error", error: "拆信失败" }));
    expect((await findProblems(env, T0)).map((p) => p.key)).toEqual(["error"]);
  });

  it("同一个问题 24 小时内只提醒一次；过了 24 小时还在就再提醒", async () => {
    const { emails, env, sent } = setup();
    await emails.push(row(1, failed), row(2, failed));
    await runMonitor(env, T0);
    await runMonitor(env, T0 + 6 * HOUR);
    expect(sent).toHaveLength(1);
    // 新失败的信不断进来，24 小时后仍有问题
    await emails.push(row(3, { ...failed, stored_at: new Date(T0 + 23 * HOUR).toISOString() }), row(4, { ...failed, stored_at: new Date(T0 + 23 * HOUR).toISOString() }));
    await runMonitor(env, T0 + 25 * HOUR);
    expect(sent).toHaveLength(2);
  });

  it("没配发信：查得出问题，但不报错、不记成已提醒", async () => {
    const { emails, env } = setup();
    delete env.EMAIL;
    await emails.push(row(1, failed), row(2, failed));
    const r = await runMonitor(env, T0);
    expect(r.problems).toHaveLength(1);
    expect(r.alerted).toEqual([]);
  });
});

describe("看板自己发的信被 Gmail 转回来", () => {
  it("验证码、监控提醒：自动转回来的不像招聘信，直接丢掉，不存、不调模型", async () => {
    const { e, emails } = baseSetup({ LOGIN_FROM: "login@my.example" });
    const mail: IncomingMail = {
      envelopeFrom: "bounce@x.example",
      envelopeTo: "jobs@my.example",
      headers: [{ key: "x-forwarded-for", value: `${ME} jobs@my.example` }],
      from: "准点监控 <login@my.example>",
      subject: "准点提醒：AI 解析失败多",
      text: "过去 24 小时……",
      html: undefined,
      date: "Thu, 15 Oct 2026 08:00:00 -0400",
      messageId: "<alert@x>",
    };
    const r = await handleIncoming(mail, e, T0, () => "id-a");
    expect(r).toEqual({ kind: "skipped" });
    expect(emails()).toHaveLength(0);
  });
});
