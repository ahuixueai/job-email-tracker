import { describe, expect, it } from "vitest";
import { handleIncoming } from "../src/inbox.js";
import type { IncomingMail } from "../src/inbox.js";
import { runReminders } from "../src/reminders.js";
import type { OutgoingEmail } from "../src/types.js";
import { DOMAIN, ME, owner, ownerSetting, setup } from "./helpers.js";

/** 收到一封笔试通知（北京时间 10/20 19:00 = UTC 11:00）之后，定时任务什么时候发提醒、发给谁、发几次。 */
const exam: IncomingMail = {
  envelopeFrom: "bounce@xinghe.example",
  envelopeTo: `jobs@${DOMAIN}`,
  headers: [{ key: "x-forwarded-for", value: `${ME} jobs@${DOMAIN}` }],
  from: "星河科技校园招聘 <campus@xinghe.example>",
  subject: "【星河科技】在线笔试通知",
  text: "同学你好，\n考试时间：10月20日 19:00-20:40（北京时间）\n考试链接：https://exam.xinghe.example/start\n考试码：XHKJ-7Q4M",
  html: undefined,
  date: "Mon, 12 Oct 2026 11:00:00 +0800",
  messageId: "<exam@xinghe.example>",
};

function withMailbox() {
  const t = setup({ LOGIN_FROM: "login@my.example" });
  const sent: OutgoingEmail[] = [];
  t.e.EMAIL = { send: (m) => (sent.push(m), Promise.resolve({ messageId: "x" })) };
  return { ...t, sent };
}

describe("邮件提醒定时任务", () => {
  it("前一天晚上 8 点（求职地北京时间）发一封，只发一次；发到登录邮箱", async () => {
    const t = withMailbox();
    const me = await owner(t.e);
    await ownerSetting(t.e, "prefs", JSON.stringify({ timeZones: { job: "Asia/Shanghai" } }));
    expect((await handleIncoming(exam, t.e, Date.parse("2026-10-12T03:00:00Z"), () => "e1")).kind).toBe("stored");

    expect(await runReminders(t.e, Date.parse("2026-10-19T11:50:00Z"))).toEqual({ mails: 0, items: 0, failed: 0 });
    expect(await runReminders(t.e, Date.parse("2026-10-19T12:05:00Z"))).toEqual({ mails: 1, items: 1, failed: 0 });
    expect(t.sent[0]!.to).toBe(me.email);
    expect(t.sent[0]!.subject).toContain("明天 19:00");
    expect(t.sent[0]!.text).toContain("XHKJ-7Q4M");
    expect(await runReminders(t.e, Date.parse("2026-10-19T12:20:00Z"))).toEqual({ mails: 0, items: 0, failed: 0 });
  });

  it("关掉邮件提醒就不发；准点自己发的信被转回来直接丢掉", async () => {
    const t = withMailbox();
    await owner(t.e);
    await ownerSetting(t.e, "prefs", JSON.stringify({ timeZones: { job: "Asia/Shanghai" }, calendar: { emailReminders: false } }));
    await handleIncoming(exam, t.e, Date.parse("2026-10-12T03:00:00Z"), () => "e1");
    expect((await runReminders(t.e, Date.parse("2026-10-19T12:05:00Z"))).mails).toBe(0);

    const bounced = await handleIncoming(
      { ...exam, from: "准点提醒 <login@my.example>", subject: "明天 19:00 在线笔试 · 星河科技", messageId: "<r@x>" },
      t.e,
      Date.parse("2026-10-19T12:06:00Z"),
      () => "e2",
    );
    expect(bounced).toEqual({ kind: "skipped" });
  });
});
