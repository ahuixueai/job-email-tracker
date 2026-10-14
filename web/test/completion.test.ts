import { describe, expect, it } from "vitest";
import { applyEdits, phaseOf } from "@/lib/demo/agenda";
import type { AgendaItem } from "@/lib/demo/agenda";
import { buildApplications, nextText } from "@/lib/demo/applications";
import { notParsedResult, describeWhen } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";
import { countdown } from "@/components/demo/TodayView";
import { complete, EMPTY_EDITS, hasEdits, parseEdits, uncomplete } from "@/lib/demo/userEdits";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const TZ = "Asia/Shanghai";

function item(id: string, utc: string | null, dueType: DemoResult["dueType"] = "fixed_start", eventType: DemoResult["eventType"] = "interview"): AgendaItem {
  const result: DemoResult = {
    ...notParsedResult("", ""),
    destination: "board",
    company: "远山集团",
    displayCompany: "远山集团",
    eventType,
    kindLabel: "视频面试",
    dueType,
    when: utc === null ? null : describeWhen(utc, TZ, TZ),
    dedupKey: `远山集团|${id}`,
  };
  return { key: id, id, place: "board", origin: "email", decision: null, completion: null, note: null, editedFields: [], result, sources: [{ sampleId: id, subject: "" }] };
}

describe("完成", () => {
  it("存取：标完成 / 没参加，撤销后回到原样；读坏的条目丢掉", () => {
    const done = complete(EMPTY_EDITS, "a", "done", 1);
    expect(hasEdits(done)).toBe(true);
    expect(parseEdits(JSON.parse(JSON.stringify(done))).completions).toEqual({ a: { state: "done", atMs: 1 } });
    expect(uncomplete(done, "a")).toEqual(EMPTY_EDITS);
    expect(parseEdits({ version: 1, completions: { a: { state: "maybe" }, b: { state: "missed" } } }).completions).toEqual({ b: { state: "missed", atMs: 0 } });
  });

  it("阶段：还没到 / 正在进行 → active；过了两小时没标 → overdue（不自动算完成）；截止过了立刻 overdue", () => {
    expect(phaseOf(item("a", "2026-10-15T13:00:00Z"), NOW)).toBe("active");
    expect(phaseOf(item("b", "2026-10-15T11:00:00Z"), NOW)).toBe("active");
    expect(phaseOf(item("c", "2026-10-15T09:00:00Z"), NOW)).toBe("overdue");
    expect(phaseOf(item("d", "2026-10-15T11:00:00Z", "deadline"), NOW)).toBe("overdue");
    expect(phaseOf(item("e", null, "unknown"), NOW)).toBe("active");
    const [doneItem] = applyEdits([item("c", "2026-10-15T09:00:00Z")], complete(EMPTY_EDITS, "c", "done", NOW), TZ);
    expect(phaseOf(doneItem!, NOW)).toBe("done");
  });

  it("面试标完成后，投递表下一步变成「等结果」，7 天后跟进", () => {
    const agenda = applyEdits([item("i1", "2026-10-15T05:30:00Z")], complete(EMPTY_EDITS, "i1", "done", NOW), TZ);
    const emails = [{ sampleId: "i1", subject: "", body: "", receivedAtUtc: "2026-10-10T00:00:00Z", result: agenda[0]!.result, place: "board" as const }];
    const rows = buildApplications(emails, agenda, EMPTY_EDITS, NOW);
    expect(rows[0]!.next).toEqual({ label: "等视频面试结果（10月15日已完成）", utc: null, isDeadline: false, dateOnly: "2026-10-22" });
    expect(nextText(rows[0]!, TZ)).toBe("等视频面试结果（10月15日已完成） · 10月22日跟进");
    expect(rows[0]!.followUpDue).toBe(false);
    // 7 天后再看：该跟进了
    expect(buildApplications(emails, agenda, EMPTY_EDITS, NOW + 8 * 86_400_000)[0]!.followUpDue).toBe(true);
  });

  it("还有更晚的一场没做：下一步仍显示那一场", () => {
    const edits = complete(EMPTY_EDITS, "i1", "done", NOW);
    const agenda = applyEdits([item("i1", "2026-10-15T05:30:00Z"), item("i2", "2026-10-20T05:30:00Z")], edits, TZ);
    const emails = agenda.map((a) => ({ sampleId: a.id, subject: "", body: "", receivedAtUtc: "2026-10-10T00:00:00Z", result: a.result, place: "board" as const }));
    const rows = buildApplications(emails, agenda, edits, NOW);
    expect(rows[0]!.next?.utc).toBe("2026-10-20T05:30:00Z");
  });
});

describe("倒计时", () => {
  it("分钟 / 小时 / 天 / 已开始", () => {
    expect(countdown(NOW + 25 * 60_000, NOW)).toBe("还有 25 分钟");
    expect(countdown(NOW + 135 * 60_000, NOW)).toBe("还有 2 小时 15 分");
    expect(countdown(NOW + 3 * 3_600_000, NOW)).toBe("还有 3 小时");
    expect(countdown(NOW + 3 * 86_400_000, NOW)).toBe("还有 3 天");
    expect(countdown(NOW + 36 * 3_600_000, NOW)).toBe("还有 1 天 12 小时");
    expect(countdown(NOW - 20 * 60_000, NOW)).toBe("已经开始 20 分钟");
  });
});
