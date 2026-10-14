import { beforeAll, describe, expect, it } from "vitest";
import { runDemoParse } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";
import type { SampleEmail } from "@/lib/demo/sampleEmails";
import { blockSender, EMPTY_EDITS, parseEdits, trashEmails, untrashEmails } from "@/lib/demo/userEdits";
import { buildBoardData } from "@/lib/demo/view";

const TZ = "Asia/Shanghai";
const NOW = Date.parse("2026-10-13T06:00:00Z");

function sample(id: string, subject: string, body: string, from = "星河科技校园招聘 <campus@xinghe.example>"): SampleEmail {
  return { id, title: subject, teaches: "", tokens: {}, raw: { id, from, to: "", subject, body, receivedAtUtc: "2026-10-12T03:00:00.000Z" } };
}

const SAMPLES = [
  sample("a", "【星河科技】在线笔试通知", "考试时间：10月20日 19:00-20:40（北京时间）"),
  sample("b", "【北辰数据】面试邀请", "面试时间：10月21日 14:00（北京时间）", "北辰数据 <hr@beichen.example>"),
];
let results: Map<string, DemoResult>;

beforeAll(async () => {
  results = new Map();
  for (const s of SAMPLES) results.set(s.id, await runDemoParse(s.raw, { viewerTimeZone: TZ }));
});

describe("看板视图数据", () => {
  it("没有修改时：两封信各成一件事", () => {
    const data = buildBoardData(SAMPLES, results, EMPTY_EDITS, NOW, TZ);
    expect(data.agenda.filter((i) => i.place === "board")).toHaveLength(2);
    expect(data.trashed).toHaveLength(0);
  });

  it("删除一封信：从它来的日程和投递一起消失，信进回收站；恢复后回来", () => {
    const edits = trashEmails(EMPTY_EDITS, ["a"], 1);
    const data = buildBoardData(SAMPLES, results, edits, NOW, TZ);
    expect(data.samples.map((s) => s.id)).toEqual(["b"]);
    expect(data.trashed.map((s) => s.id)).toEqual(["a"]);
    expect(data.agenda.some((i) => i.sources.some((s) => s.sampleId === "a"))).toBe(false);
    expect(data.applications.some((r) => r.emailIds.includes("a"))).toBe(false);
    const back = buildBoardData(SAMPLES, results, untrashEmails(edits, ["a"]), NOW, TZ);
    expect(back.samples).toHaveLength(2);
    // 读写一致
    expect(parseEdits(JSON.parse(JSON.stringify(edits))).deletedEmails).toEqual({ a: 1 });
  });

  it("屏蔽发件人：那封信按已忽略，不进日程", () => {
    const data = buildBoardData(SAMPLES, results, blockSender(EMPTY_EDITS, "hr@beichen.example"), NOW, TZ);
    expect(data.results.get("b")?.destination).toBe("dropped");
    expect(data.agenda.filter((i) => i.place === "board").map((i) => i.id)).toEqual(["a"]);
  });
});
