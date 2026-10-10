import { describe, expect, it } from "vitest";
import type { Extraction, LLMExtractor } from "../src/extract.js";
import { EMPTY_EXTRACTION, StubExtractor } from "../src/extract.js";
import type { RawEmail } from "../src/rawEmail.js";
import { parseEmail, summarize } from "../src/pipeline.js";
import { dedupKeyOf } from "../src/dedup.js";
import type { ParseDeps, ParseOutcome } from "../src/pipeline.js";

/** 可编程的假抽取器：想测哪种模型输出就给哪种。 */
function fake(over: Partial<Extraction> = {}): LLMExtractor {
  return { extract: () => Promise.resolve({ ...EMPTY_EXTRACTION, ...over }) };
}

function mail(over: Partial<RawEmail> = {}): RawEmail {
  return {
    id: "mail-1",
    from: "campus@jd.com",
    to: "u_abc@inbox.example.com",
    subject: "来自京东集团的笔试邀请",
    body: "笔试时间：8月15日 10:00-11:40（北京时间），请提前 15 分钟登录。",
    receivedAtUtc: "2026-08-11T13:34:00.000Z",
    ...over,
  };
}

function parsed(outcome: ParseOutcome) {
  if (outcome.kind !== "parsed") throw new Error(`期望解析成功，实际被丢弃：${outcome.reason}`);
  return outcome;
}

const stubDeps: ParseDeps = { extractor: new StubExtractor() };

describe("parseEmail 主链路", () => {
  it("一封完整的笔试邀请，四路信号都干净", async () => {
    const out = parsed(await parseEmail(mail(), stubDeps));
    expect(out.event.company).toBe("京东");
    expect(out.event.companyMatched).toBe(true);
    expect(out.event.eventType).toBe("assessment");
    expect(out.event.dueType).toBe("fixed_start");
    expect(out.event.sourceTimeZone).toBe("Asia/Shanghai");
    expect(out.event.startUtc).toBe("2026-08-15T02:00:00.000Z");
    expect(out.event.endUtc).toBe("2026-08-15T03:40:00.000Z");
    expect(out.event.confidence).toBe("high");
  });

  it("sourceRef 指回具体邮件，rawHash 用于幂等", async () => {
    const out = parsed(await parseEmail(mail({ id: "mail-42" }), stubDeps));
    expect(out.event.sourceRef).toBe("mail-42");
    expect(out.rawHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("相对期限不依赖时区也能算准", async () => {
    const out = parsed(
      await parseEmail(
        mail({
          from: "noreply-xiaomihire@mail.hire.feishu.cn",
          subject: "小米集团测评邀请",
          body: "请在收到邮件后 72 小时内完成在线测评。",
        }),
        stubDeps,
      ),
    );
    expect(out.event.eventType).toBe("assessment");
    expect(out.event.dueType).toBe("deadline");
    expect(out.event.startUtc).toBe("2026-08-14T13:34:00.000Z");
  });

  it("预筛丢弃的邮件不产生事件", async () => {
    const out = await parseEmail(
      mail({ subject: "您的验证码", body: "验证码 123456，5 分钟内有效" }),
      stubDeps,
    );
    expect(out.kind).toBe("dropped");
    expect(summarize(out)).toContain("丢弃");
  });
});

describe("模型建议只在规则没结论时兜底", () => {
  const vague = mail({
    subject: "关于后续安排的说明",
    body: "我们会尽快与您联系，请留意查收岗位相关信息。",
  });

  it("规则判不出时采纳建议，但整条降到 low 进待确认", async () => {
    const out = parsed(await parseEmail(vague, { extractor: fake({ eventTypeHint: "interview" }) }));
    expect(out.event.eventType).toBe("interview");
    expect(out.event.confidence).toBe("low");
    expect(out.trace.usedEventTypeHint).toBe(true);
    expect(out.trace.confidenceReasons.join("")).toContain("模型建议");
  });

  it("规则已有结论时，模型的不同意见被忽略", async () => {
    const out = parsed(await parseEmail(mail(), { extractor: fake({ eventTypeHint: "result" }) }));
    expect(out.event.eventType).toBe("assessment");
    expect(out.trace.usedEventTypeHint).toBe(false);
  });

  it("建议本身是 other 时不算兜底", async () => {
    const out = parsed(await parseEmail(vague, { extractor: fake({ eventTypeHint: "other" }) }));
    expect(out.trace.usedEventTypeHint).toBe(false);
  });

  it("模型说与求职无关 → 强制 low", async () => {
    const out = parsed(await parseEmail(mail(), { extractor: fake({ notJobRelated: true }) }));
    expect(out.event.confidence).toBe("low");
  });
});

describe("台账地区反哺时区推断（第 4 优先级）", () => {
  const noHint = mail({
    from: "hr@example-corp.net",
    subject: "【某科技】面试邀请",
    body: "面试定于 8月20日 14:00，请准时参加。",
  });

  it("查不到地区时，如实返回时区未知并降级", async () => {
    const out = parsed(await parseEmail(noHint, stubDeps));
    expect(out.event.sourceTimeZone).toBeNull();
    expect(out.event.confidence).not.toBe("high");
  });

  it("台账有地区记录时补上时区", async () => {
    const out = parsed(
      await parseEmail(noHint, {
        extractor: new StubExtractor(),
        lookupCompanyRegion: () => "深圳",
      }),
    );
    expect(out.event.sourceTimeZone).toBe("Asia/Shanghai");
    expect(out.trace.tz.source).toBe("ledger");
  });
});

describe("抽取结果的下游去向", () => {
  it("岗位与地点进 application 侧，不污染 event", async () => {
    const out = parsed(
      await parseEmail(
        mail({ body: "笔试时间：8月15日 10:00（北京时间），工作地点 深圳，岗位 数据分析实习生。" }),
        { extractor: fake({ roleRaw: "数据分析实习生", locationRaw: "深圳" }) },
      ),
    );
    expect(out.application.role).toBe("数据分析实习生");
    expect(out.application.region).toBe("深圳");
    expect(Object.keys(out.event)).not.toContain("role");
  });

  it("模型幻觉出的时间片段在管线里就被挡掉", async () => {
    const out = parsed(await parseEmail(mail(), { extractor: fake({ timeText: "9月9日 08:00" }) }));
    expect(out.trace.extraction.timeText).toBeNull();
    expect(out.event.startUtc).toBe("2026-08-15T02:00:00.000Z");
  });

  it("timeText 命中时只按那一段判时间", async () => {
    const out = parsed(
      await parseEmail(mail(), { extractor: fake({ timeText: "8月15日 10:00-11:40" }) }),
    );
    expect(out.event.startUtc).toBe("2026-08-15T02:00:00.000Z");
  });
});

describe("转发进来的历史正文不干扰解析", () => {
  it("改期通知取新时间，不取被引用的原定时间", async () => {
    const out = parsed(
      await parseEmail(
        mail({
          subject: "面试时间调整通知",
          body:
            "您的面试时间调整至 8月20日 14:00（北京时间）。\n" +
            "------ 原始邮件 ------\n" +
            "原定面试时间 8月18日 09:30（北京时间）",
        }),
        stubDeps,
      ),
    );
    expect(out.event.startUtc).toBe("2026-08-20T06:00:00.000Z");
    expect(out.event.eventType).toBe("interview");
    expect(out.trace.eventType.shouldMerge).toBe(true);
  });
});

describe("结构性不变量", () => {
  it("解析结果永远满足 unknown ⇒ startUtc 为 null", async () => {
    const out = parsed(
      await parseEmail(mail({ subject: "岗位申请已收到", body: "我们已收到你的申请。" }), stubDeps),
    );
    expect(out.event.dueType).toBe("unknown");
    expect(out.event.startUtc).toBeNull();
  });

  it("summarize 给出一行可读摘要", async () => {
    const line = summarize(await parseEmail(mail(), stubDeps));
    expect(line).toContain("京东");
    expect(line).toContain("assessment");
  });
});

describe("催办邮件合并进它提醒的那件事", () => {
  const invite = mail({
    id: "mail-invite",
    subject: "京东集团邀请你参加在线笔试",
    body: "京东产品经理专业笔试 0815 场，8月15日 10:00-11:40（北京时间），需摄像头。",
    receivedAtUtc: "2026-08-13T08:02:00.000Z",
  });
  const nag = mail({
    id: "mail-nag",
    subject: "京东集团邀请你参加在线笔试",
    body: "重复提醒：京东产品经理专业笔试 0815 场，8月15日 10:00-11:40（北京时间），需摄像头。",
    receivedAtUtc: "2026-08-14T08:02:00.000Z",
  });

  it("催办入库时的事件类型是被提醒的那件事，不是「提醒」", async () => {
    const out = parsed(await parseEmail(nag, stubDeps));
    expect(out.event.eventType).toBe("assessment");
    // 这封信本身仍然被认定为催办，只是它描述的事件是笔试
    expect(out.trace.eventType.eventType).toBe("reminder");
    expect(out.trace.eventType.mergeAs).toBe("assessment");
  });

  it("邀请与催办落到同一个 dedupKey —— baseline 第 2 节那条重复记录的根因", async () => {
    const a = parsed(await parseEmail(invite, stubDeps));
    const b = parsed(await parseEmail(nag, stubDeps));
    expect(dedupKeyOf(b.event)).toBe(dedupKeyOf(a.event));
  });

  it("认不出在提醒什么时不硬凑，作为独立记录处理", async () => {
    const out = parsed(
      await parseEmail(
        mail({ subject: "重复提醒：请查收", body: "请尽快查看你的申请相关信息。" }),
        stubDeps,
      ),
    );
    expect(out.trace.eventType.mergeAs).toBeNull();
    expect(out.event.eventType).toBe("reminder");
  });

  it("改期通知同样合并，而不是新建一条 update", async () => {
    const out = parsed(
      await parseEmail(
        mail({
          subject: "面试时间调整通知",
          body: "您的面试时间调整至 8月20日 14:00（北京时间）。",
        }),
        stubDeps,
      ),
    );
    expect(out.event.eventType).toBe("interview");
    expect(out.trace.eventType.mergeAs).toBe("interview");
  });
});

describe("边界与防御", () => {
  it("发件人取不到域名时照常解析，不因缺线索崩掉", async () => {
    const out = parsed(await parseEmail(mail({ from: "无效发件人" }), stubDeps));
    expect(out.event.eventType).toBe("assessment");
    expect(out.event.sourceTimeZone).toBe("Asia/Shanghai");
  });

  it("模型返回脏值时收敛成空抽取，管线不崩", async () => {
    const dirty = { extract: () => Promise.resolve("不是对象" as never) };
    const out = parsed(await parseEmail(mail(), { extractor: dirty }));
    expect(out.trace.extraction.companyRaw).toBeNull();
    expect(out.event.eventType).toBe("assessment");
  });
});
