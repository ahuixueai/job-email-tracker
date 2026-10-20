import { describe, expect, it } from "vitest";
import { normalizeCompany, resolveCompany, stripGenericWords } from "../src/company.js";
import { companyFromSubject, EMPTY_EXTRACTION } from "../src/extract.js";
import type { LLMExtractor } from "../src/extract.js";
import { parseEmail } from "../src/pipeline.js";
import type { ParseOutcome } from "../src/pipeline.js";

/**
 * 模型没响应、退回规则时，也要认得出公司。
 * 规则这一侧补三条后备线索：发件域名本身是别名、发件人显示名、标题格式；
 * 以及中英混写（「DJI 大疆」「大疆DJI」）、地区后缀（「德勤中国」）归到同一家。
 */

describe("中英混写、地区后缀归到同一家", () => {
  it("DJI / 大疆 / DJI大疆 / 大疆DJI / dji 大疆 都是大疆创新", () => {
    for (const name of ["DJI", "dji", "大疆", "大疆创新", "DJI大疆", "大疆DJI", "dji 大疆", "DJI 大疆", "DJI·大疆"]) {
      expect(normalizeCompany(name), name).toEqual({ canonical: "大疆创新", matched: true });
    }
  });

  it("德勤中国 = 德勤；Deloitte = 德勤", () => {
    expect(normalizeCompany("德勤中国").canonical).toBe("德勤");
    expect(normalizeCompany("Deloitte").canonical).toBe("德勤");
  });

  it("拆开的几段指向两家公司：不认（错并比认不出糟）", () => {
    expect(normalizeCompany("京东阿里巴巴").matched).toBe(false);
  });

  it("英文内部不拆：「Loreal Group Holdings」不会拆出 Loreal", () => {
    expect(normalizeCompany("Loreal Group Holdings").matched).toBe(false);
  });
});

describe("套话剥离", () => {
  it("显示名里的招聘套话去掉，剩下公司名", () => {
    expect(stripGenericWords("CN Deloitte Campus Recruitment Service")).toBe("Deloitte");
    expect(stripGenericWords("DJI大疆校园招聘")).toBe("DJI大疆");
    expect(stripGenericWords("recruitment")).toBe("");
    expect(stripGenericWords("智联招聘")).toBe("");
    expect(stripGenericWords("【在线邀请】青禾集团27届")).toBe("青禾集团");
  });

  it("标题格式取出的套话、收件人名字不当公司", () => {
    expect(companyFromSubject("【提醒】星河科技在线笔试")).toBeNull();
    expect(companyFromSubject("【智联推荐】某公司 2027 管培生")).toBeNull();
    expect(companyFromSubject("张三的面试邀请")).toBeNull();
    expect(companyFromSubject("【星河科技】一面邀请")).toBe("星河科技");
  });
});

describe("resolveCompany：模型没给公司名时的后备线索", () => {
  it("发件域名本身是别名：dji.com → 大疆创新", () => {
    expect(resolveCompany({ raw: null, senderDomain: "dji.com", senderName: "recruitment" })).toMatchObject({ canonical: "大疆创新", matched: true, source: "domain" });
  });

  it("个人邮箱、招聘网站的域名不当公司线索", () => {
    expect(resolveCompany({ raw: null, senderDomain: "qq.com" }).canonical).toBe("");
    expect(resolveCompany({ raw: null, senderDomain: "mail34.lietou-edm.com", senderName: "猎聘" }).canonical).toBe("");
  });

  it("显示名去掉套话后认得出：CN Deloitte Campus Recruitment Service → 德勤", () => {
    expect(resolveCompany({ raw: null, senderDomain: "deloitte-campus.example", senderName: "CN Deloitte Campus Recruitment Service" })).toMatchObject({
      canonical: "德勤",
      matched: true,
      source: "sender",
    });
  });

  it("招聘系统代发、显示名是公司全称：照原样用（云帆集团 → 云帆）", () => {
    expect(resolveCompany({ raw: null, senderDomain: "shmail.ibeisen.com", senderName: "云帆集团" })).toMatchObject({ canonical: "云帆", matched: false, source: "sender" });
  });

  it("招聘系统代发、显示名是招聘专员的名字：不当公司", () => {
    expect(resolveCompany({ raw: null, senderDomain: "shmail.ibeisen.com", senderName: "张伟" }).canonical).toBe("");
  });

  it("公司自己的域名发信：认不出的显示名不用（多半是「HR」「某某老师」）", () => {
    expect(resolveCompany({ raw: null, senderDomain: "unknown-corp.example", senderName: "星河科技集团" }).canonical).toBe("");
  });

  it("模型给了认得出的名字：以模型为准，不看后备线索", () => {
    expect(resolveCompany({ raw: "大疆", senderDomain: "shmail.ibeisen.com", senderName: "德勤" })).toMatchObject({ canonical: "大疆创新", source: "model" });
  });
});

describe("parseEmail：模型超时（抽取为空）时也认得出公司", () => {
  const empty: LLMExtractor = { extract: () => Promise.resolve({ ...EMPTY_EXTRACTION }) };
  const parsed = (o: ParseOutcome) => {
    if (o.kind !== "parsed") throw new Error(o.reason);
    return o;
  };
  const mail = (from: string, subject: string) => ({
    id: "m",
    from,
    to: "jobs@my.example",
    subject,
    body: "同学你好，感谢关注，请留意后续通知。面试时间：2026-10-20 10:00（北京时间）",
    receivedAtUtc: "2026-10-15T04:30:00.000Z",
  });

  it("大疆：recruitment <recruitment@dji.com>", async () => {
    const out = parsed(await parseEmail(mail("recruitment <recruitment@dji.com>", "欢迎投递 DJI 大疆 2027 校园招聘职位"), { extractor: empty }));
    expect(out.event.company).toBe("大疆创新");
  });

  it("云帆：云帆集团 <noreply@shmail.ibeisen.com>", async () => {
    const out = parsed(await parseEmail(mail("云帆集团 <noreply@shmail.ibeisen.com>", "面试提醒"), { extractor: empty }));
    expect(out.event.company).toBe("云帆");
  });

  it("德勤：CN Deloitte Campus Recruitment Service", async () => {
    const out = parsed(await parseEmail(mail("CN Deloitte Campus Recruitment Service <campus@deloitte-mail.example>", "德勤中国 2027 校园招聘 | 线上面试通知"), { extractor: empty }));
    expect(out.event.company).toBe("德勤");
  });
});
