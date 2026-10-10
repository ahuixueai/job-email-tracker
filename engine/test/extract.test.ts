import { describe, expect, it } from "vitest";
import { isGrounded, StubExtractor, validateExtraction } from "../src/extract.js";
import { toCleanEmail } from "../src/rawEmail.js";

const SOURCE = "来自京东集团的笔试邀请 笔试时间 8月15日 10:00，地点 深圳，岗位 数据分析实习生";

describe("isGrounded", () => {
  it("原文出现过的片段算接地", () => {
    expect(isGrounded("8月15日 10:00", SOURCE)).toBe(true);
  });

  it("空白差异不影响判定", () => {
    expect(isGrounded("8月15日10:00", SOURCE)).toBe(true);
  });

  it("原文没有的片段不算接地", () => {
    expect(isGrounded("8月20日 14:00", SOURCE)).toBe(false);
  });

  it("空片段不算接地", () => {
    expect(isGrounded("   ", SOURCE)).toBe(false);
  });
});

describe("validateExtraction", () => {
  it("正常字段原样通过", () => {
    const r = validateExtraction(
      { companyRaw: "京东集团", roleRaw: "数据分析实习生", locationRaw: "深圳", timeText: "8月15日 10:00" },
      SOURCE,
    );
    expect(r.companyRaw).toBe("京东集团");
    expect(r.timeText).toBe("8月15日 10:00");
    expect(r.locationRaw).toBe("深圳");
  });

  it("幻觉出来的时间片段被丢掉，而不是流进时间字段", () => {
    const r = validateExtraction({ timeText: "9月1日 09:00" }, SOURCE);
    expect(r.timeText).toBeNull();
  });

  it("幻觉出来的地点同样被丢掉", () => {
    expect(validateExtraction({ locationRaw: "纽约" }, SOURCE).locationRaw).toBeNull();
  });

  it("公司名不做接地检查——它常需要从域名或签名档重构", () => {
    expect(validateExtraction({ companyRaw: "京东" }, SOURCE).companyRaw).toBe("京东");
  });

  it("不认识的 eventTypeHint 收敛成 null，不抛异常", () => {
    expect(validateExtraction({ eventTypeHint: "OA" }, SOURCE).eventTypeHint).toBeNull();
    expect(validateExtraction({ eventTypeHint: "assessment" }, SOURCE).eventTypeHint).toBe("assessment");
  });

  it("非对象输入返回空抽取而不是崩溃", () => {
    expect(validateExtraction(null, SOURCE).companyRaw).toBeNull();
    expect(validateExtraction("[]", SOURCE).companyRaw).toBeNull();
    expect(validateExtraction(42, SOURCE).notJobRelated).toBe(false);
  });

  it("超长字段被截断，防模型把整封信塞进一个字段", () => {
    const long = "字".repeat(500);
    expect((validateExtraction({ companyRaw: long }, SOURCE).companyRaw ?? "").length).toBe(200);
  });

  it("空串与非字符串一律收敛成 null", () => {
    expect(validateExtraction({ companyRaw: "   ", roleRaw: 7 }, SOURCE).companyRaw).toBeNull();
    expect(validateExtraction({ roleRaw: 7 }, SOURCE).roleRaw).toBeNull();
  });

  it("notJobRelated 只认真正的 true", () => {
    expect(validateExtraction({ notJobRelated: "true" }, SOURCE).notJobRelated).toBe(false);
    expect(validateExtraction({ notJobRelated: true }, SOURCE).notJobRelated).toBe(true);
  });
});

describe("StubExtractor", () => {
  const stub = new StubExtractor();
  const mail = (subject: string) =>
    toCleanEmail({
      id: "m",
      from: "hr@example.com",
      to: "u@x.com",
      subject,
      body: "正文",
      receivedAtUtc: "2026-08-11T13:34:00.000Z",
    });

  it("认得「来自 X 的邀请」", async () => {
    expect((await stub.extract(mail("来自岚图汽车科技股份有限公司的更新简历邀请"))).companyRaw)
      .toBe("岚图汽车科技股份有限公司");
  });

  it("认得【X】前缀", async () => {
    expect((await stub.extract(mail("【美的集团】笔试通知"))).companyRaw).toBe("美的集团");
  });

  it("认得「X 测评邀请」", async () => {
    expect((await stub.extract(mail("小米集团测评邀请"))).companyRaw).toBe("小米集团");
  });

  it("认不出就老实返回 null，不猜", async () => {
    expect((await stub.extract(mail("关于后续流程的说明"))).companyRaw).toBeNull();
  });

  it("桩不产生任何时间或类型建议——判定权不在这一层", async () => {
    const r = await stub.extract(mail("小米集团测评邀请"));
    expect(r.timeText).toBeNull();
    expect(r.eventTypeHint).toBeNull();
    expect(r.notJobRelated).toBe(false);
  });
});
