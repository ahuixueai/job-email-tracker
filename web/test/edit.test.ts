import { describe, expect, it } from "vitest";
import { applyEdits } from "@/lib/demo/agenda";
import type { AgendaItem } from "@/lib/demo/agenda";
import { buildApplications, nextText } from "@/lib/demo/applications";
import type { ApplicationEmail } from "@/lib/demo/applications";
import { describeWhen, notParsedResult } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";
import {
  clearItemEdit,
  clearRow,
  editItem,
  editRow,
  EMPTY_EDITS,
  hasEdits,
  parseEdits,
  patchApplication,
  rememberCompanyName,
} from "@/lib/demo/userEdits";

const TZ = "Asia/Shanghai";
const NOW = Date.parse("2026-10-13T06:00:00Z");

function item(): AgendaItem {
  const result: DemoResult = {
    ...notParsedResult("", ""),
    destination: "board",
    company: "提醒",
    displayCompany: "提醒",
    eventType: "assessment",
    format: "written_test",
    kindLabel: "笔试",
    dueType: "fixed_start",
    when: describeWhen("2026-10-20T11:00:00Z", TZ, TZ),
    timeZone: TZ,
    dedupKey: "提醒|x",
  };
  return { key: "e1", id: "e1", place: "board", origin: "email", decision: null, completion: null, note: null, editedFields: [], result, sources: [{ sampleId: "e1", subject: "" }] };
}

describe("编辑日程上的一件事", () => {
  it("改公司、类型、时间、备注：叠在系统结论上；合并用的公司名不变", () => {
    const edits = editItem(EMPTY_EDITS, "e1", {
      company: "星河科技",
      kind: "video_interview",
      time: { timeKind: "fixed_start", startUtc: "2026-10-21T02:00:00.000Z", timeZone: TZ },
      note: "面试官是 HR 总监",
    });
    const [edited] = applyEdits([item()], edits, TZ);
    expect(edited!.result.displayCompany).toBe("星河科技");
    expect(edited!.result.company).toBe("提醒");
    expect(edited!.result.kindLabel).toBe("视频面试");
    expect(edited!.result.when?.utc).toBe("2026-10-21T02:00:00.000Z");
    expect(edited!.note).toBe("面试官是 HR 总监");
    expect(edited!.editedFields).toEqual(["公司", "类型", "时间"]);
  });

  it("再改一次只覆盖新改的字段；恢复系统判断后回到原样", () => {
    const once = editItem(EMPTY_EDITS, "e1", { company: "星河科技" });
    const twice = editItem(once, "e1", { note: "带简历" });
    expect(twice.itemEdits.e1).toEqual({ company: "星河科技", note: "带简历" });
    const restored = clearItemEdit(twice, "e1");
    expect(hasEdits(restored)).toBe(false);
    expect(applyEdits([item()], restored, TZ)[0]!.result.displayCompany).toBe("提醒");
  });

  it("存取：读回来一样；坏字段丢掉", () => {
    const edits = rememberCompanyName(editItem(EMPTY_EDITS, "e1", { role: "", note: "x", kind: "written_test" }), "提醒", "星河科技");
    expect(parseEdits(JSON.parse(JSON.stringify(edits)))).toEqual(edits);
    expect(parseEdits({ version: 1, itemEdits: { a: { kind: "nope", company: "" } } }).itemEdits).toEqual({});
    // 记住改名：原名和新名一样、或为空，不记
    expect(rememberCompanyName(EMPTY_EDITS, "提醒", "提醒")).toBe(EMPTY_EDITS);
    expect(rememberCompanyName(EMPTY_EDITS, "", "星河")).toBe(EMPTY_EDITS);
  });
});

describe("编辑投递表的一行", () => {
  const email: ApplicationEmail = {
    sampleId: "e1",
    subject: "感谢投递",
    body: "",
    receivedAtUtc: "2026-10-01T00:00:00Z",
    result: { ...item().result, eventType: "application_ok" },
    place: "tracked",
  };

  it("公司、岗位、地点、下一步、跟进日期、备注都以你为准；只改备注不算「改过」", () => {
    const edits = editRow(EMPTY_EDITS, "提醒", { company: "星河科技", role: "管培生", location: "上海", next: "等笔试", followUp: "2026-10-10", note: "HR 姓王" });
    const [row] = buildApplications([email], [], edits, NOW);
    expect(row).toMatchObject({ company: "星河科技", role: "管培生", location: "上海", note: "HR 姓王", edited: true, followUpDue: true });
    expect(nextText(row!, TZ)).toBe("等笔试 · 10月10日跟进");
    const noteOnly = buildApplications([email], [], editRow(EMPTY_EDITS, "提醒", { note: "x" }), NOW)[0]!;
    expect(noteOnly.edited).toBe(false);
    expect(noteOnly.note).toBe("x");
  });

  it("清空下一步和跟进日期 = 特意清掉；恢复会连状态一起退回系统推断", () => {
    const cleared = buildApplications([email], [], editRow(EMPTY_EDITS, "提醒", { next: "", followUp: "" }), NOW)[0]!;
    expect(cleared.next).toBeNull();
    const both = editRow(patchApplication(EMPTY_EDITS, "提醒", { stage: "offer", round: null }), "提醒", { role: "x" });
    expect(clearRow(both, "提醒")).toEqual(EMPTY_EDITS);
  });
});
