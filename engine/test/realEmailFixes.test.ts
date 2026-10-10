import { describe, expect, it } from "vitest";
import type { Extraction, LLMExtractor } from "../src/extract.js";
import { EMPTY_EXTRACTION } from "../src/extract.js";
import type { RawEmail } from "../src/rawEmail.js";
import { toCleanEmail } from "../src/rawEmail.js";
import { parseEmail } from "../src/pipeline.js";
import type { ParseOutcome } from "../src/pipeline.js";
import { prefilter } from "../src/prefilter.js";
import { isVerificationNoise } from "../src/noise.js";
import { decodeHtmlEntities, normalizeText } from "../src/text.js";
import { classifyDue } from "../src/dueType.js";
import { findRelativeDeadline } from "../src/relative.js";
import { classifyEventType } from "../src/eventType.js";
import { classifyEventFormat } from "../src/eventFormat.js";
import { composeConfidence } from "../src/confidence.js";
import { route } from "../src/inbox.js";

/**
 * 2026-10 真实邮件评测（147 封）暴露的问题，逐条固化成回归用例。
 *
 * 用例全部是**合成文本**：只保留真实邮件里导致误判的那个句式结构，
 * 公司、人名、链接都是编的。真实邮件原文留在私有的 eval/ 下，不进测试。
 */

const TZ = "Asia/Shanghai";
const RECEIVED = "2026-09-24T01:09:20.000Z"; // 北京时间 09-24 09:09

function fake(over: Partial<Extraction> = {}): LLMExtractor {
  return { extract: () => Promise.resolve({ ...EMPTY_EXTRACTION, ...over }) };
}

function mail(over: Partial<RawEmail> = {}): RawEmail {
  return {
    id: "m1",
    from: "campus@xinghe.example",
    to: "u_abc@inbox.example.com",
    subject: "【星河科技】在线测评邀请",
    body: "请在收到邮件后 72 小时内完成在线测评。",
    receivedAtUtc: RECEIVED,
    ...over,
  };
}

function parsed(outcome: ParseOutcome) {
  if (outcome.kind !== "parsed") throw new Error(`期望解析成功，实际被丢弃：${outcome.reason}`);
  return outcome;
}

function destinationOf(outcome: ParseOutcome): string {
  const p = parsed(outcome);
  return route(p.event.confidence, p.event.eventType, p.trace.confidenceReasons).destination;
}

describe("验证码噪音：只认「这封信就是验证码邮件」", () => {
  const invite =
    "现诚邀您参与在线测评，测评有效期为 5 个自然日。登录时需输入短信验证码，短信验证码有效期为 5 分钟。";

  it("测评邀请正文里提到登录验证码，不算噪音", () => {
    expect(isVerificationNoise("来自星河科技的测评邀请", invite)).toBe(false);
  });

  it("这样的测评邀请不再被预筛丢弃", () => {
    const email = toCleanEmail(mail({ subject: "来自星河科技的测评邀请", body: invite }));
    expect(prefilter(email).verdict).toBe("pass");
  });

  it("它被判成测评，并读出 5 个自然日的期限", async () => {
    const out = parsed(
      await parseEmail(mail({ subject: "来自星河科技的测评邀请", body: invite }), {
        extractor: fake({ companyRaw: "星河科技" }),
      }),
    );
    expect(out.event.eventType).toBe("assessment");
    expect(out.event.dueType).toBe("deadline");
    expect(out.event.startUtc).toBe("2026-09-29T01:09:20.000Z");
  });

  it("标题就是验证码的，照旧是噪音——哪怕正文出现了「面试」", () => {
    expect(isVerificationNoise("面试系统登录验证码", "您的验证码是 123456，用于登录面试系统")).toBe(true);
  });

  it("纯验证码正文照旧是噪音", () => {
    expect(isVerificationNoise("", "您的验证码是 483920，5分钟内有效。")).toBe(true);
    expect(isVerificationNoise("", "Your verification code is 8891")).toBe(true);
    expect(isVerificationNoise("One-Time Password for Candidate Account", "Use this password")).toBe(true);
  });

  it("没有验证码字样的不是噪音", () => {
    expect(isVerificationNoise("笔试通知", "笔试时间：8月15日 10:00")).toBe(false);
  });
});

describe("HTML 实体与零宽字符", () => {
  it("还原常见实体", () => {
    expect(decodeHtmlEntities("A&nbsp;B&amp;C&lt;D&gt;&quot;E&quot;&#39;F&#x4E2D;")).toBe("A B&C<D>\"E\"'F中");
  });

  it("认不出的实体原样保留", () => {
    expect(decodeHtmlEntities("R&D; &unknownname; &#0;")).toBe("R&D; &unknownname; &#0;");
  });

  it("没有 & 的文本不动", () => {
    expect(decodeHtmlEntities("笔试时间 10:00")).toBe("笔试时间 10:00");
  });

  it("零宽字符被去掉", () => {
    expect(normalizeText("面​试﻿时间")).toBe("面试时间");
  });

  it("日期和钟点之间夹着 &nbsp; 仍能配上对", () => {
    const r = classifyDue(
      "面试日期:&nbsp; 2026-09-30 周三 &nbsp; &nbsp; 面试时间:&nbsp; 10:30",
      RECEIVED,
      TZ,
    );
    expect(r.dueType).toBe("fixed_start");
    expect(r.startUtc).toBe("2026-09-30T02:30:00.000Z");
  });

  it("钟点和「前」之间夹着 &nbsp; 仍判截止", () => {
    const r = classifyDue("请在&nbsp; 2026-10-17 24:00 &nbsp; 前，点击下方按钮完善信息。", RECEIVED, TZ);
    expect(r.dueType).toBe("deadline");
    expect(r.startUtc).toBe("2026-10-17T15:59:00.000Z");
  });

  it("清洗后的邮件正文里不再有实体", () => {
    const email = toCleanEmail(mail({ body: "面试时间:&nbsp;10:30&nbsp;&nbsp;地点：线上" }));
    expect(email.body).toBe("面试时间: 10:30 地点:线上");
    expect(email.body).not.toContain("&nbsp;");
  });
});

describe("「生效…失效」一句话两个时刻", () => {
  it("失效时刻是截止，精确到分钟", () => {
    const r = classifyDue(
      "本次测评邀请于 2026年09月24日 09:09 生效，于 2026年10月01日 09:09 失效，请尽快完成。",
      RECEIVED,
      TZ,
    );
    expect(r.dueType).toBe("deadline");
    expect(r.startUtc).toBe("2026-10-01T01:09:00.000Z");
  });

  it("日期和钟点之间有星期也一样", () => {
    const r = classifyDue(
      "于 2026年09月24日 周四 09:09 生效，于 2026年10月09日 周五 08:06 失效",
      RECEIVED,
      TZ,
    );
    expect(r.dueType).toBe("deadline");
    expect(r.startUtc).toBe("2026-10-09T00:06:00.000Z");
  });

  it("签发时刻本身仍然不会被当成场次", () => {
    const r = classifyDue("本次邀请于 2026年09月24日 09:09 生效。", RECEIVED, TZ);
    expect(r.dueType).not.toBe("fixed_start");
  });
});

describe("时刻后带括注的「前」", () => {
  it("（北京时间）前 → 截止", () => {
    const r = classifyDue("请务必在2026-09-25 00:00（北京时间）前填写并提交完毕。", RECEIVED, TZ);
    expect(r.dueType).toBe("deadline");
    expect(r.startUtc).toBe("2026-09-24T16:00:00.000Z");
  });

  it("句尾出现「面试时间」不把紧贴着「前」的时刻变成场次", () => {
    const r = classifyDue("请在2026-09-25 17:00（回复截止时间）前反馈面试时间。", RECEIVED, TZ);
    expect(r.dueType).toBe("deadline");
    expect(r.startUtc).toBe("2026-09-25T09:00:00.000Z");
  });

  it("场次标签写在时刻前面时，铁律一不变：仍是场次", () => {
    const r = classifyDue("面试时间：2026-09-25 17:00 前请提前十分钟入会", RECEIVED, TZ);
    expect(r.dueType).toBe("fixed_start");
  });

  it("「请提前登录」不是截止", () => {
    const r = classifyDue("笔试时间：2026-09-25 10:00，请提前 15 分钟登录。", RECEIVED, TZ);
    expect(r.dueType).toBe("fixed_start");
  });
});

describe("模型圈选片段：只限定看哪个时刻，不裁掉上下文", () => {
  const full =
    "同学你好，请在2026-09-25 17:00前反馈是否参加。如有疑问请联系我们。本邮件发送于 2026-09-24 09:09。";

  it("模型只圈了时刻本身，「前」仍然看得见", () => {
    const r = classifyDue(full, RECEIVED, TZ, "2026-09-25 17:00");
    expect(r.dueType).toBe("deadline");
    expect(r.startUtc).toBe("2026-09-25T09:00:00.000Z");
  });

  it("圈选之外的时刻不参与竞争", () => {
    const text = "活动报名截止 2026-09-26 12:00。考试时间：2026-09-28 10:00。";
    const r = classifyDue(text, RECEIVED, TZ, "截止 2026-09-26 12:00");
    expect(r.dueType).toBe("deadline");
    expect(r.startUtc).toBe("2026-09-26T04:00:00.000Z");
  });

  it("圈选片段的空白与原文不同也能定位", () => {
    const r = classifyDue("考试时间：\n2026-09-28   10:00", RECEIVED, TZ, "考试时间： 2026-09-28 10:00");
    expect(r.dueType).toBe("fixed_start");
    expect(r.startUtc).toBe("2026-09-28T02:00:00.000Z");
  });

  it("圈选片段里是相对期限", () => {
    const r = classifyDue("请于收到邮件后 48 小时内完成测评。考试须知见附件。", RECEIVED, TZ, "48 小时内完成测评");
    expect(r.dueType).toBe("deadline");
    expect(r.startUtc).toBe("2026-09-26T01:09:20.000Z");
  });

  it("定位不到的片段退回单独分类", () => {
    const r = classifyDue("正文里没有时间", RECEIVED, TZ, "考试时间：2026-09-28 10:00");
    expect(r.dueType).toBe("fixed_start");
  });

  it("空片段等于没给", () => {
    expect(classifyDue(full, RECEIVED, TZ, "  ").dueType).toBe(classifyDue(full, RECEIVED, TZ).dueType);
    expect(classifyDue(full, RECEIVED, TZ, null).startUtc).toBe(classifyDue(full, RECEIVED, TZ).startUtc);
  });
});

describe("相对期限的另外几种说法", () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  it("N 小时后截止", () => {
    expect(findRelativeDeadline("第一项AI面试即将在 24小时后截止，请在此之前完成。")?.ms).toBe(24 * HOUR);
  });

  it("N 天后失效", () => {
    expect(findRelativeDeadline("该链接将于3天后失效")?.ms).toBe(3 * DAY);
  });

  it("有效期为 N 个自然日", () => {
    expect(findRelativeDeadline("测评有效期为 5 个自然日，答题时长为 70 分钟")?.ms).toBe(5 * DAY);
  });

  it("有效期：72小时", () => {
    expect(findRelativeDeadline("链接有效期：72小时")?.ms).toBe(72 * HOUR);
  });

  it("有效期 N 个工作日按工作日算", () => {
    const hit = findRelativeDeadline("有效期为3个工作日");
    expect(hit?.businessDays).toBe(true);
    expect(hit?.count).toBe(3);
  });

  it("有效期两周", () => {
    expect(findRelativeDeadline("邀请有效期为两周")?.ms).toBe(14 * DAY);
  });

  it("验证码的有效期（分钟）不是这件事的期限", () => {
    expect(findRelativeDeadline("短信验证码有效期为 5 分钟")).toBeNull();
  });

  it("招聘方自己的时间表不算", () => {
    expect(findRelativeDeadline("我们的回复有效期为 3 天")).toBeNull();
  });

  it("You have N days to …", () => {
    expect(findRelativeDeadline("You have 10 days to complete the assessment.")?.ms).toBe(10 * DAY);
    expect(findRelativeDeadline("You'll have 48 hours to submit your answers.")?.ms).toBe(48 * HOUR);
  });
});

describe("事件类型：回执、拒信、补材料、问卷", () => {
  const type = (subject: string, body: string) => classifyEventType({ subject, body }).eventType;

  it("ATS 标准回执「已收到您对 X 的申请」", () => {
    expect(type("感谢您的职位投递！", "我们已收到您对 策略产品经理-深圳 的申请，并会尽快查看您的简历。")).toBe(
      "application_ok",
    );
  });

  it("几种常见的中文拒信说法", () => {
    expect(type("应聘反馈通知", "很抱歉地通知您，您与所申请的岗位要求暂不匹配，因此无法进入流程下一阶段。")).toBe("result");
    expect(type("感谢您应聘", "遗憾的是，经过仔细评估，您的情况与该职位需求略有差异，暂时无法一起继续前进了。")).toBe("result");
  });

  it("标题是补材料：正文里顺带提到面试也不改判", () => {
    expect(type("【星河科技】邀请您更新应聘信息", "我们邀请您在面试/入职之前更新或补充最新的应聘信息。")).toBe("update");
    expect(type("请完善网申登记表信息", "你的登记表存在关键信息缺失，可能影响后续面试安排。")).toBe("update");
    expect(type("应聘登记表【请务必在面试前完成填写】", "面试前需填写《应聘登记表》。")).toBe("update");
  });

  it("正文说更新申请表", () => {
    expect(type("来自星河科技的邀请", "请点击以下链接更新个人《校园招聘申请表》。")).toBe("update");
  });

  it("标题是满意度调查：不是流程里的一步", () => {
    const r = classifyEventType({
      subject: "【星河科技校招】面试体验满意度调查",
      body: "感谢你于 2026-09-22 21:30 参加面试，请于收到此邮件后的24小时内完成问卷。",
    });
    expect(r.eventType).toBe("other");
    expect(r.confidence).toBe("low");
  });

  it("正文顺带提到问卷的测评邀请不受影响", () => {
    expect(type("测评通知", "我们邀请您作答一份测评问卷，请尽快作答。")).toBe("assessment");
  });

  it("真正的面试邀请不受影响", () => {
    expect(type("面试邀请", "诚邀你参加视频面试，面试时间：9月25日 14:00")).toBe("interview");
  });
});

describe("规则与模型意见不一致：模型只能否决，不能提名", () => {
  const receipt = mail({
    subject: "感谢投递星河科技",
    body: "感谢您的投递。本次招聘流程为简历初筛、在线测评、面试、录用。后续进展请留意邮件通知。",
  });

  it("规则见词判成测评，模型说是回执 → 类型不改，但进待确认", async () => {
    const out = await parseEmail(receipt, {
      extractor: fake({ companyRaw: "星河科技", eventTypeHint: "application_ok" }),
    });
    const p = parsed(out);
    expect(p.event.eventType).toBe("assessment");
    expect(p.event.confidence).toBe("low");
    expect(p.trace.confidenceReasons.join("；")).toContain("两边不一致");
    expect(destinationOf(out)).toBe("pending");
  });

  it("模型说这不是流程事件，且没有具体时刻 → 折叠为噪音", async () => {
    const out = await parseEmail(
      mail({ subject: "名企秋招岗位推荐", body: "热招岗位：管培生，流程含笔试与面试，点击查看更多职位。" }),
      { extractor: fake({ companyRaw: "某招聘平台", eventTypeHint: "other" }) },
    );
    const p = parsed(out);
    expect(p.event.eventType).toBe("other");
    expect(p.trace.eventType.eventType).not.toBe("other"); // 规则原判保留在 trace 里可追溯
    expect(destinationOf(out)).toBe("noise");
  });

  it("模型说不是流程事件，但规则读出了具体时刻 → 不折叠，留在待确认", async () => {
    const out = await parseEmail(
      mail({ subject: "笔试通知", body: "笔试时间：2026-09-28 10:00（北京时间）" }),
      { extractor: fake({ companyRaw: "星河科技", eventTypeHint: "other" }) },
    );
    const p = parsed(out);
    expect(p.event.eventType).toBe("assessment");
    expect(p.event.startUtc).toBe("2026-09-28T02:00:00.000Z");
    expect(destinationOf(out)).toBe("pending");
  });

  it("两边一致时不降级", async () => {
    const out = await parseEmail(
      mail({ subject: "笔试通知", body: "笔试时间：2026-09-28 10:00（北京时间）" }),
      { extractor: fake({ companyRaw: "京东", eventTypeHint: "assessment" }) },
    );
    expect(parsed(out).event.confidence).toBe("high");
    expect(destinationOf(out)).toBe("board");
  });

  it("模型没给意见时不算分歧", async () => {
    const out = await parseEmail(
      mail({ subject: "笔试通知", body: "笔试时间：2026-09-28 10:00（北京时间）" }),
      { extractor: fake({ companyRaw: "京东" }) },
    );
    expect(destinationOf(out)).toBe("board");
  });

  it("催办邮件：模型说的是被催的那件事，也算一致", async () => {
    const out = await parseEmail(
      mail({ subject: "重复提醒：笔试通知", body: "笔试时间：2026-09-28 10:00（北京时间）" }),
      { extractor: fake({ companyRaw: "京东", eventTypeHint: "assessment" }) },
    );
    const p = parsed(out);
    expect(p.trace.eventType.eventType).toBe("reminder");
    expect(p.trace.confidenceReasons.join("；")).not.toContain("不一致");
  });

  it("规则没结论时采纳模型建议的旧行为不变：进待确认", async () => {
    const out = await parseEmail(
      mail({ subject: "关于你的申请", body: "请查收附件。" }),
      { extractor: fake({ companyRaw: "星河科技", eventTypeHint: "update" }) },
    );
    const p = parsed(out);
    expect(p.event.eventType).toBe("update");
    expect(p.trace.usedEventTypeHint).toBe(true);
    expect(destinationOf(out)).toBe("pending");
  });
});

describe("模型圈了截止，全文另有场次：场次赢，并降级", () => {
  const invite = mail({
    subject: "面试邀约",
    body: "我们诚挚地邀请您参加面试。面试时间：2026/10/27 13:30-18:00（北京时间）。无论是否参加，请在10月9日9:00前回复。",
    receivedAtUtc: "2026-10-08T05:52:00.000Z",
  });

  it("采用面试时间，而不是回复期限", async () => {
    const out = await parseEmail(invite, {
      extractor: fake({ companyRaw: "京东", eventTypeHint: "interview", timeText: "请在10月9日9:00前回复" }),
    });
    const p = parsed(out);
    expect(p.event.dueType).toBe("fixed_start");
    expect(p.event.startUtc).toBe("2026-10-27T05:30:00.000Z");
    expect(p.event.confidence).toBe("low");
    expect(p.trace.confidenceReasons.join("；")).toContain("未到的场次");
    expect(destinationOf(out)).toBe("pending");
  });

  it("模型圈的就是场次时，不触发", async () => {
    const out = await parseEmail(invite, {
      extractor: fake({ companyRaw: "京东", eventTypeHint: "interview", timeText: "面试时间：2026/10/27 13:30-18:00" }),
    });
    const p = parsed(out);
    expect(p.event.startUtc).toBe("2026-10-27T05:30:00.000Z");
    expect(p.event.confidence).toBe("high");
  });

  it("全文里的场次已经过去时，不拿它顶掉模型圈的截止", async () => {
    const out = await parseEmail(
      mail({
        subject: "测评提醒",
        body: "你于 2026-09-20 10:00 参加了宣讲会。请在2026-09-30 18:00（北京时间）前完成在线测评。",
      }),
      { extractor: fake({ companyRaw: "京东", eventTypeHint: "assessment", timeText: "请在2026-09-30 18:00（北京时间）前完成在线测评" }) },
    );
    const p = parsed(out);
    expect(p.event.dueType).toBe("deadline");
    expect(p.event.startUtc).toBe("2026-09-30T10:00:00.000Z");
    expect(p.trace.confidenceReasons.join("；")).not.toContain("未到的场次");
  });
});

describe("形式：字段 → 标题 → 全文", () => {
  it("形式字段压过正文后面的顺带一提", () => {
    const text = "视频面试邀请 面试方式： 视频面试 （请提前10分钟入会）。面试形式有临时转为电话面的可能性。";
    expect(classifyEventFormat(text, "interview", "视频面试邀请").format).toBe("video_interview");
  });

  it("没有标题参数时，字段仍然优先", () => {
    const text = "面试形式有临时转为电话面的可能。面试方式：视频面试";
    expect(classifyEventFormat(text, "interview").format).toBe("video_interview");
  });

  it("标题是测评，注意事项里的「笔试页面」不改判", () => {
    const text = "在线测评邀请 如遇断网，可重新登录笔试页面继续作答。";
    expect(classifyEventFormat(text, "assessment", "在线测评邀请").format).toBe("online_assessment");
  });

  it("标题是测评，结尾提到后续 AI 面试不改判", () => {
    const text = "人才测评环节 如测评通过，后续还有1轮AI面试。";
    expect(classifyEventFormat(text, "assessment", "人才测评环节").format).toBe("online_assessment");
  });

  it("字段内容认不出时退到标题和全文", () => {
    const text = "面试通知 面试方式：详见附件。本次为电话面试。";
    expect(classifyEventFormat(text, "interview", "面试通知").format).toBe("phone_interview");
  });

  it("标题没线索时仍按全文判", () => {
    expect(classifyEventFormat("通知 请加入腾讯会议", "interview", "通知").format).toBe("video_interview");
  });
});

describe("置信度：两种分歧都压到 low，理由可见", () => {
  const base = {
    eventType: "assessment" as const,
    eventTypeConfidence: "high" as const,
    dueType: "deadline" as const,
    dueConfidence: "high" as const,
    startUtc: "2026-09-28T02:00:00.000Z",
    hasCompany: true,
    companyMatched: true,
    tz: { tz: "Asia/Shanghai", source: "explicit", confidence: "high", reason: "" } as never,
    truncated: false,
    usedEventTypeHint: false,
    notJobRelated: false,
  };

  it("没有分歧时是 high", () => {
    expect(composeConfidence(base).confidence).toBe("high");
    expect(composeConfidence({ ...base, eventTypeConflict: null, timeScopeConflict: false }).confidence).toBe("high");
  });

  it("类型分歧", () => {
    const r = composeConfidence({ ...base, eventTypeConflict: { rule: "assessment", hint: "application_ok" } });
    expect(r.confidence).toBe("low");
    expect(r.reasons.join("；")).toContain("模型判为 application_ok");
  });

  it("模型认为不是流程事件", () => {
    const r = composeConfidence({ ...base, eventTypeConflict: { rule: "assessment", hint: "other" } });
    expect(r.confidence).toBe("low");
    expect(r.reasons.join("；")).toContain("不是一件流程事件");
  });

  it("时间范围分歧", () => {
    const r = composeConfidence({ ...base, timeScopeConflict: true });
    expect(r.confidence).toBe("low");
  });
});

describe("被压平成单行的引用历史", () => {
  // stripQuoted 原本靠行首锚定识别引用头，正文没有换行时全部失效
  it("Outlook 引用头（发件人…发送时间）写在同一行也能剥掉", async () => {
    const { stripQuoted } = await import("../src/rawEmail.js");
    const body =
      "同学你好，收到你的简历啦。 ________________________________ 发件人: Someone <a@b.example> 发送时间: 2026年9月20日 3:02:29 收件人: HR 主题: 应聘";
    const out = stripQuoted(body);
    expect(out).toContain("收到你的简历");
    expect(out).not.toContain("3:02:29");
  });

  it("英文 Outlook 引用头", async () => {
    const { stripQuoted } = await import("../src/rawEmail.js");
    const out = stripQuoted("Thanks, noted. From: Jane Doe <j@x.example> Sent: Monday, September 21, 2026 9:00 AM To: HR");
    expect(out.trim()).toBe("Thanks, noted.");
  });

  it("Gmail 引用头写在同一行", async () => {
    const { stripQuoted } = await import("../src/rawEmail.js");
    expect(stripQuoted("好的，收到。 On Mon, Sep 21, 2026 at 9:00 AM Jane <j@x.example> wrote: 面试时间 9月25日 10:00").trim()).toBe("好的，收到。");
    expect(stripQuoted("好的，收到。 在 2026年9月21日 上午9:00，某某 写道： 面试时间 9月25日 10:00").trim()).toBe("好的，收到。");
  });

  it("正文里的「From … To …」时间段不是引用头", async () => {
    const { stripQuoted } = await import("../src/rawEmail.js");
    const body = "Interview slot From: 10:00 To: 11:00 on September 25.";
    expect(stripQuoted(body)).toBe(body);
  });

  it("引用历史里的旧时间不再被读成本封信的时间", async () => {
    const out = parsed(
      await parseEmail(
        mail({
          subject: "自动答复: 应聘",
          body: "收到你的简历啦，后续笔试、面试通知将通过系统发送。 ________________________________ 发件人: Someone <a@b.example> 发送时间: 2026年9月30日 10:00:00 收件人: HR",
        }),
        { extractor: fake({ companyRaw: "星河科技" }) },
      ),
    );
    expect(out.event.startUtc).toBeNull();
  });
});

describe("模型说「这是催办」不算分歧", () => {
  it("规则判出具体类型、模型说 reminder → 不降级", async () => {
    const out = await parseEmail(
      mail({ subject: "笔试通知", body: "笔试时间：2026-09-28 10:00（北京时间），请准时参加。" }),
      { extractor: fake({ companyRaw: "京东", eventTypeHint: "reminder" }) },
    );
    const p = parsed(out);
    expect(p.event.eventType).toBe("assessment");
    expect(p.trace.confidenceReasons.join("；")).not.toContain("不一致");
    expect(destinationOf(out)).toBe("board");
  });
});
