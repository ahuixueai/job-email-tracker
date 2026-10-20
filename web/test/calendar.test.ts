import { describe, expect, it } from "vitest";
import type { AgendaItem } from "@/lib/demo/agenda";
import { buildIcs } from "@/lib/demo/calendar";
import { describeWhen, notParsedResult } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";

const NOW = Date.parse("2026-10-13T00:00:00Z");

function item(id: string, utc: string, over: Partial<DemoResult> = {}, extra: Partial<AgendaItem> = {}): AgendaItem {
  const result: DemoResult = {
    ...notParsedResult("", ""),
    destination: "board",
    company: "星河科技",
    displayCompany: "星河科技",
    eventType: "interview",
    kindLabel: "视频面试",
    dueType: "fixed_start",
    when: describeWhen(utc, "Asia/Shanghai", "UTC"),
    ...over,
  };
  return { key: id, id, place: "board", origin: "email", decision: null, completion: null, note: null, editedFields: [], result, sources: [], ...extra };
}

describe("日历订阅内容", () => {
  it("准点开始：开始起 1 小时，提前 30 分钟提醒；截止：截止前 30 分钟，提前 1 天提醒", () => {
    const ics = buildIcs(
      [item("a", "2026-10-20T11:00:00.000Z"), item("b", "2026-10-21T06:00:00.000Z", { dueType: "deadline", kindLabel: "在线测评" })],
      NOW,
      "https://board.example",
    );
    expect(ics).toContain("DTSTART:20261020T110000Z\r\nDTEND:20261020T120000Z");
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(ics).toContain("DTSTART:20261021T053000Z\r\nDTEND:20261021T060000Z");
    expect(ics).toContain("SUMMARY:截止：在线测评 · 星河科技");
    expect(ics).toContain("TRIGGER;RELATED=END:-P1D");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("做完的打勾、不提醒；没参加的、不在日程上的、没时刻的都不放", () => {
    const ics = buildIcs(
      [
        item("done", "2026-10-20T11:00:00.000Z", {}, { completion: { state: "done", atMs: 1 } }),
        item("missed", "2026-10-20T11:00:00.000Z", {}, { completion: { state: "missed", atMs: 1 } }),
        item("pending", "2026-10-20T11:00:00.000Z", {}, { place: "pending" }),
        item("notime", "2026-10-20T11:00:00.000Z", { when: null }),
      ],
      NOW,
      "https://board.example",
    );
    expect(ics.split("BEGIN:VEVENT")).toHaveLength(2);
    expect(ics).toContain("SUMMARY:✓ 视频面试 · 星河科技");
    expect(ics).not.toContain("VALARM");
  });

  it("特殊字符转义；长行按字节折行（中文一个字 3 字节）", () => {
    const ics = buildIcs([item("x;y", "2026-10-20T11:00:00.000Z", { displayCompany: "星河,科技;集团".repeat(6) })], NOW, "https://board.example");
    expect(ics).toContain("星河\\,科技\\;集团");
    expect(ics).toContain("UID:x_y@interviewtrack.me");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("日历提醒的提前量（设置里选）", () => {
  const agenda = () => [item("a", "2026-10-20T11:00:00.000Z"), item("b", "2026-10-21T06:00:00.000Z", { dueType: "deadline", kindLabel: "在线测评" })];
  it("按选的写：准点 30 分钟、截止 3 小时", () => {
    const ics = buildIcs(agenda(), NOW, "https://board.example", { fixedAlarm: 30, deadlineAlarm: 180, emailReminders: true });
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(ics).toContain("TRIGGER;RELATED=END:-PT3H");
  });
  it("选「不提醒」就不放提醒", () => {
    const ics = buildIcs(agenda(), NOW, "https://board.example", { fixedAlarm: null, deadlineAlarm: null, emailReminders: true });
    expect(ics).not.toContain("BEGIN:VALARM");
    expect(ics.split("BEGIN:VEVENT")).toHaveLength(3);
  });
});
