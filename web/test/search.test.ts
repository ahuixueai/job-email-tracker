import { describe, expect, it } from "vitest";
import { isSearching, matchEmail, matchRow } from "@/lib/demo/search";
import type { ApplicationRow } from "@/lib/demo/applications";
import type { SampleEmail } from "@/lib/demo/sampleEmails";

const row = { company: "远山集团", role: "营销管培生", location: "上海", next: { label: "等群面结果", utc: null, isDeadline: false }, note: "HR 姓王" } as unknown as ApplicationRow;
const email = { raw: { subject: "【星河科技】笔试通知", from: "HR <hr@xinghe.example>" } } as unknown as SampleEmail;

describe("搜索", () => {
  it("公司、岗位、地点、下一步、备注都能搜到；几个词都要命中；不分大小写", () => {
    expect(matchRow(row, "远山")).toBe(true);
    expect(matchRow(row, "上海 群面")).toBe(true);
    expect(matchRow(row, "上海 北京")).toBe(false);
    expect(matchRow(row, "hr")).toBe(true);
    expect(matchEmail(email, undefined, "XINGHE")).toBe(true);
    expect(matchEmail(email, undefined, "面试")).toBe(false);
  });
  it("只有空格不算在搜", () => {
    expect(isSearching("   ")).toBe(false);
    expect(isSearching(" 远山 ")).toBe(true);
  });
});
