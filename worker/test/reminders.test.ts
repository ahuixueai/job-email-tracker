import { describe, expect, it } from "vitest";
import type { AgendaItem } from "../../web/lib/demo/agenda";
import { composeReminderMail, eveSendAt, pickReminders, reminderKey } from "../src/reminders.js";

const NY = "America/New_York";
const H = 3_600_000;

function item(over: { id: string; utc: string; dueType: "fixed_start" | "deadline" | "date_only"; done?: boolean; note?: string }): AgendaItem {
  return {
    key: over.id,
    id: over.id,
    place: "board",
    origin: "email",
    decision: null,
    completion: over.done ? { state: "done", atMs: 0 } : null,
    note: over.note ?? null,
    editedFields: [],
    sources: [],
    result: {
      when: { utc: over.utc, source: null, viewer: null, sameZone: true },
      dueType: over.dueType,
      kindLabel: over.dueType === "deadline" ? "在线测评" : "视频面试",
      displayCompany: over.dueType === "deadline" ? "长青保险" : "云帆",
      role: "营销管理培训生",
      timeZone: "Asia/Shanghai",
      links: ["https://meeting.example.com/j/123456789"],
      credentials: [{ label: "会议号", value: "123 456 789" }],
    },
  } as unknown as AgendaItem;
}

describe("邮件提醒：什么时候发", () => {
  // 北京时间 10/21 13:30 的面试 = 纽约 10/21 01:30
  const interview = item({ id: "iv", utc: "2026-10-21T05:30:00Z", dueType: "fixed_start" });

  it("准点开始的：前一天晚上 8 点（你所在地）", () => {
    expect(new Date(eveSendAt(Date.parse(interview.result.when!.utc), NY)).toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(pickReminders([interview], Date.parse("2026-10-20T23:59:00Z"), NY, new Set())).toHaveLength(0);
    const due = pickReminders([interview], Date.parse("2026-10-21T00:00:00Z"), NY, new Set());
    expect(due.map((r) => r.kind)).toEqual(["eve"]);
    // 发过就不再发；离开始不到 30 分钟也不发
    expect(pickReminders([interview], Date.parse("2026-10-21T01:00:00Z"), NY, new Set([due[0]!.key]))).toHaveLength(0);
    expect(pickReminders([interview], Date.parse("2026-10-21T05:10:00Z"), NY, new Set())).toHaveLength(0);
  });

  it("截止的：前 24 小时一封、前 3 小时一封；标了完成就不发", () => {
    const test = item({ id: "t", utc: "2026-10-22T15:59:00Z", dueType: "deadline" });
    const at = Date.parse(test.result.when!.utc);
    expect(pickReminders([test], at - 25 * H, NY, new Set())).toHaveLength(0);
    expect(pickReminders([test], at - 23 * H, NY, new Set()).map((r) => r.kind)).toEqual(["due24"]);
    expect(pickReminders([test], at - 2 * H, NY, new Set([reminderKey(test, "due24")])).map((r) => r.kind)).toEqual(["due3"]);
    expect(pickReminders([item({ id: "t2", utc: test.result.when!.utc, dueType: "deadline", done: true })], at - 2 * H, NY, new Set())).toHaveLength(0);
  });

  it("时间改了：按新时间再提醒一次", () => {
    const moved = item({ id: "iv", utc: "2026-10-22T05:30:00Z", dueType: "fixed_start" });
    expect(reminderKey(moved, "eve")).not.toBe(reminderKey(interview, "eve"));
  });
});

describe("邮件提醒：写了什么", () => {
  it("一件事：标题写时间和什么事；正文有链接、会议号、当地时间、备注", () => {
    const iv = item({ id: "iv", utc: "2026-10-21T05:30:00Z", dueType: "fixed_start", note: "提前 10 分钟进会议" });
    const now = Date.parse("2026-10-21T00:00:00Z");
    const mail = composeReminderMail(pickReminders([iv], now, NY, new Set()), now, NY, "https://board.interviewtrack.me");
    expect(mail.subject).toBe("明天 01:30 视频面试 · 云帆");
    expect(mail.text).toContain("链接：https://meeting.example.com/j/123456789");
    expect(mail.text).toContain("会议号：123 456 789");
    expect(mail.text).toContain("10月21日 周三 13:30（北京时间）");
    expect(mail.text).toContain("你的备注：提前 10 分钟进会议");
    expect(mail.html).toContain('href="https://meeting.example.com/j/123456789"');
  });

  it("几件事合成一封", () => {
    const now = Date.parse("2026-10-21T00:00:00Z");
    const list = [item({ id: "iv", utc: "2026-10-21T05:30:00Z", dueType: "fixed_start" }), item({ id: "t", utc: "2026-10-21T15:59:00Z", dueType: "deadline" })];
    const mail = composeReminderMail(pickReminders(list, now, NY, new Set()), now, NY, "https://board.interviewtrack.me");
    expect(mail.subject).toBe("明天 01:30 视频面试 · 云帆 等 2 件事");
    expect(mail.text).toContain("明天 11:59 截止：在线测评 · 长青保险");
  });
});
