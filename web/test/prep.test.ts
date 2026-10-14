import { describe, expect, it } from "vitest";
import { buildPrepUserPrompt, findPrepBlock, formatPrep, parsePrepOutput, parsePrepRequest, prepEdited, prepEmailsFor, prepHash, writePrep } from "@/lib/demo/prep";
import type { PrepOutput } from "@/lib/demo/prep";

const OUTPUT: PrepOutput = {
  focus: [{ point: "数据分析能力", basis: "面试邀请信" }],
  questions: [
    { type: "行为", q: "讲一次你推动跨部门合作的经历" },
    { type: "case", q: "估算一个城市的外卖订单量" },
  ],
  stories: [{ experience: "某互联网公司 用户调研实习", shows: "调研与归纳" }],
  checklist: ["公司最近一季财报"],
};

describe("AI 面试准备：模型输出要校验", () => {
  it("形状不对的条目丢掉；类型认不出归「其他」；一个问题都没有算失败", () => {
    const parsed = parsePrepOutput({
      focus: [{ point: "  沟通  " }, { basis: "没有 point" }, "乱写"],
      questions: [{ type: "CASE", q: "一道 case" }, { type: "奇怪", q: "别的" }, { q: "" }],
      stories: "不是数组",
      checklist: ["查一下", 3],
    });
    expect(parsed).toEqual({
      focus: [{ point: "沟通", basis: "按岗位名推测" }],
      questions: [
        { type: "case", q: "一道 case" },
        { type: "其他", q: "别的" },
      ],
      stories: [],
      checklist: ["查一下"],
    });
    expect(parsePrepOutput({ focus: [{ point: "x" }], questions: [] })).toBeNull();
    expect(parsePrepOutput("不是对象")).toBeNull();
  });
});

describe("AI 面试准备：写进备注", () => {
  const block = formatPrep(OUTPUT, "10月14日", true, 2);

  it("排成固定格式，首尾有标记，写明依据", () => {
    expect(block.startsWith("【AI 面试准备 · 10月14日生成】\n依据：这家公司的 2 封来信 + 你的简历。")).toBe(true);
    expect(block).toContain("1. 数据分析能力（面试邀请信）");
    expect(block).toContain("【行为】\n- 讲一次你推动跨部门合作的经历");
    expect(block.endsWith("【AI 面试准备 · 完】")).toBe(true);
    expect(formatPrep(OUTPUT, "10月14日", false, 1)).toContain("没有上传简历");
  });

  it("没有旧的：接在你写的后面；有旧的：只换那一段，你写的不动", () => {
    expect(writePrep(null, block)).toBe(block);
    const mine = "面试官是张经理";
    const first = writePrep(mine, block);
    expect(first).toBe(`${mine}\n\n${block}`);
    const newer = formatPrep({ ...OUTPUT, checklist: ["别的"] }, "10月15日", true, 2);
    const second = writePrep(`${first}\n\n我后来又写的`, newer);
    expect(second).toBe(`${mine}\n\n${newer}\n\n我后来又写的`);
    expect(findPrepBlock(second)).toBe(newer);
  });

  it("生成后你改过那一段才算「改过」", () => {
    const hash = prepHash(block);
    const note = writePrep("我的", block);
    expect(prepEdited(note, hash)).toBe(false);
    expect(prepEdited(note.replace("数据分析能力", "数据分析"), hash)).toBe(true);
    // 你在那一段外面写东西不算改过
    expect(prepEdited(`${note}\n补一句`, hash)).toBe(false);
    expect(prepEdited("没有 AI 那段", hash)).toBe(false);
  });

  it("替换文字里有 $ 也原样写入", () => {
    const withDollar = formatPrep({ ...OUTPUT, checklist: ["薪资 $&$1"] }, "10月14日", true, 1);
    expect(writePrep(writePrep(null, block), withDollar)).toBe(withDollar);
  });
});

describe("AI 面试准备：请求", () => {
  it("浏览器发来的请求逐项校验", () => {
    expect(parsePrepRequest({ company: "星河科技", kind: "视频面试", emails: [{ subject: "邀请", body: "正文", receivedAtUtc: "2026-10-10T00:00:00Z" }, { subject: 1 }] })).toEqual({
      company: "星河科技",
      role: null,
      kind: "视频面试",
      when: null,
      emails: [{ subject: "邀请", body: "正文", receivedAtUtc: "2026-10-10T00:00:00Z" }],
    });
    expect(parsePrepRequest({ kind: "x", emails: [] })).toBeNull();
  });

  it("提示词里信和简历都标成数据；没简历就写明", () => {
    const req = { company: "星河科技", role: null, kind: "视频面试", when: null, emails: [{ subject: "面试邀请", body: "请准时参加", receivedAtUtc: "x" }] };
    const withResume = buildPrepUserPrompt(req, "我的简历");
    expect(withResume).toContain("<<<信1 主题：面试邀请\n请准时参加\n信1>>>");
    expect(withResume).toContain("<<<简历\n我的简历\n简历>>>");
    expect(buildPrepUserPrompt(req, null)).toContain("求职者没有上传简历。");
  });
});

describe("AI 面试准备：挑哪些信", () => {
  const sample = (id: string, at: string) => ({ id, raw: { subject: `主题${id}`, body: `正文${id}`, receivedAtUtc: at, from: "hr@x.example" } });
  const result = (company: string, destination = "board") => ({ company, displayCompany: company, destination });
  it("这件事自己的信一定在；同一家公司的其他信也带上；广告和别家的不带；按时间从早到晚", () => {
    const samples = [sample("a", "2026-10-01T00:00:00Z"), sample("b", "2026-10-05T00:00:00Z"), sample("c", "2026-10-06T00:00:00Z"), sample("d", "2026-10-07T00:00:00Z")];
    const results = new Map<string, unknown>([
      ["a", result("星河科技")],
      ["b", result("星河科技", "noise")],
      ["c", result("云帆科技")],
      ["d", result("星河科技")],
    ]);
    const item = { result: result("星河科技"), sources: [{ sampleId: "d", subject: "主题d" }] };
    const picked = prepEmailsFor(item as never, samples as never, results as never);
    expect(picked.map((e) => e.subject)).toEqual(["主题a", "主题d"]);
  });
});
