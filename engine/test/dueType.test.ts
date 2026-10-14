import { describe, expect, it } from "vitest";
import { classifyDue, classifyDueFromSignals, normalizeText } from "../src/dueType.js";

/**
 * 本文件的用例来自阶段 1.1 需求里给出的语义规范示例，
 * 真实邮件上的评测结果见仓库根目录的 docs/EVALUATION.md（真实邮件本身不在公开仓库里）。
 */

const TZ = "Asia/Shanghai";
/** 2026-08-15 12:03 北京 */
const RECEIVED = "2026-08-15T04:03:00.000Z";

describe("A · fixed_start：文本给出明确场次", () => {
  it("「考试时间 2026-08-15 10:00-11:40」", () => {
    const r = classifyDue("考试时间 2026-08-15 10:00-11:40", RECEIVED, TZ);
    expect(r.dueType).toBe("fixed_start");
    expect(r.startUtc).toBe("2026-08-15T02:00:00.000Z");
    expect(r.endUtc).toBe("2026-08-15T03:40:00.000Z");
    expect(r.confidence).toBe("high");
  });

  it("「8月22日 14:30 视频面试」", () => {
    const r = classifyDue("8月22日 14:30 视频面试", RECEIVED, TZ);
    expect(r.dueType).toBe("fixed_start");
    expect(r.startUtc).toBe("2026-08-22T06:30:00.000Z");
    expect(r.endUtc).toBeNull();
  });

  it("中文钟点与上下午", () => {
    expect(classifyDue("8月22日 下午2点 面试", RECEIVED, TZ).startUtc).toBe(
      "2026-08-22T06:00:00.000Z",
    );
    expect(classifyDue("8月22日 上午10点30分", RECEIVED, TZ).startUtc).toBe(
      "2026-08-22T02:30:00.000Z",
    );
  });

  it("钟点写在日期之前也能配对", () => {
    const r = classifyDue("10:00 于 8月22日 开考", RECEIVED, TZ);
    expect(r.dueType).toBe("fixed_start");
    expect(r.startUtc).toBe("2026-08-22T02:00:00.000Z");
  });

  it("全角数字与冒号同样识别", () => {
    const r = classifyDue("考试时间 ２０２６-０８-１５ １０：００", RECEIVED, TZ);
    expect(r.dueType).toBe("fixed_start");
    expect(r.startUtc).toBe("2026-08-15T02:00:00.000Z");
  });
});

describe("B · deadline：相对与绝对期限", () => {
  it("相对期限从收信时刻起算，这是正确行为不是编造", () => {
    const r = classifyDue("请在72小时内完成测评", RECEIVED, TZ);
    expect(r.dueType).toBe("deadline");
    expect(r.startUtc).toBe("2026-08-18T04:03:00.000Z");
    expect(r.confidence).toBe("high");
  });

  it("小时 / 天 / 英文写法都支持", () => {
    expect(classifyDue("48小时内完成", RECEIVED, TZ).startUtc).toBe("2026-08-17T04:03:00.000Z");
    expect(classifyDue("7天内完成", RECEIVED, TZ).startUtc).toBe("2026-08-22T04:03:00.000Z");
    expect(classifyDue("3天内完成否则视为放弃", RECEIVED, TZ).startUtc).toBe(
      "2026-08-18T04:03:00.000Z",
    );
    expect(classifyDue("please finish within 48 hours", RECEIVED, TZ).startUtc).toBe(
      "2026-08-17T04:03:00.000Z",
    );
    expect(classifyDue("complete within 3 days", RECEIVED, TZ).startUtc).toBe(
      "2026-08-18T04:03:00.000Z",
    );
  });

  it("多个期限并存时取最紧的，宁可早提醒", () => {
    const r = classifyDue("测评 7天内完成，其中第一部分 24小时内完成", RECEIVED, TZ);
    expect(r.startUtc).toBe("2026-08-16T04:03:00.000Z");
  });

  it("绝对期限「8月20日前提交」解释为当日结束", () => {
    const r = classifyDue("请于8月20日前提交", RECEIVED, TZ);
    expect(r.dueType).toBe("deadline");
    // 北京 8-20 23:59 = 8-20T15:59Z。
    // 曾经取当日零点，理由是「早=安全」，那是把安全边界加错了层：
    // 边界属于提醒层（截止前 3 天 / 1 天 / 3 小时），数据层只记录事实。
    expect(r.startUtc).toBe("2026-08-20T15:59:00.000Z");
    expect(r.confidence).toBe("high");
  });
});

describe("A 与 B 同时命中时以 A 为准", () => {
  it("「8/15 10:00 开考，请于 8/13 前确认」→ fixed_start", () => {
    // 固定场次是不可错过的那个，必须赢
    const r = classifyDue("8/15 10:00 开考，请于 8/13 前确认", RECEIVED, TZ);
    expect(r.dueType).toBe("fixed_start");
    expect(r.startUtc).toBe("2026-08-15T02:00:00.000Z");
  });

  it("场次 + 相对期限并存时仍取场次", () => {
    const r = classifyDue("面试时间 8月22日 14:30，请在48小时内确认", RECEIVED, TZ);
    expect(r.dueType).toBe("fixed_start");
    expect(r.startUtc).toBe("2026-08-22T06:30:00.000Z");
  });
});

describe("C · date_only", () => {
  it("只有日期没有钟点", () => {
    const r = classifyDue("测评将于 8月20日 开放", RECEIVED, TZ);
    expect(r.dueType).toBe("date_only");
    expect(r.startUtc).toBe("2026-08-19T16:00:00.000Z");
    expect(r.confidence).toBe("medium");
  });

  it("时区未知时只能给 date_only 且降级", () => {
    const r = classifyDue("测评将于 8月20日 开放", RECEIVED, "");
    expect(r.dueType).toBe("date_only");
    expect(r.startUtc).toBeNull();
    expect(r.confidence).toBe("low");
  });

  it("时区未知时，场次也无法换算", () => {
    const r = classifyDue("考试时间 2026-08-15 10:00", RECEIVED, "Nowhere/Nothing");
    expect(r.dueType).toBe("date_only");
    expect(r.startUtc).toBeNull();
    // 但信里写的墙上时间留着，给人工确认时预填——只差你选一个时区
    expect(r.unzoned).toEqual({ local: "2026-08-15T10:00", kind: "fixed_start" });
  });

  it("时区未知：预填优先取场次，其次是期限；只有日期没有钟点就不预填", () => {
    const both = classifyDue("请于8月18日 18:00前确认。考试时间：8月20日 9:30", RECEIVED, "");
    expect(both.unzoned).toEqual({ local: "2026-08-20T09:30", kind: "fixed_start" });
    const deadline = classifyDue("请于8月18日 18:00前提交材料", RECEIVED, "");
    expect(deadline.unzoned).toEqual({ local: "2026-08-18T18:00", kind: "deadline" });
    expect(classifyDue("测评将于 8月20日 开放", RECEIVED, "").unzoned).toBeUndefined();
  });

  it("时区未知时，绝对期限同样降级", () => {
    const r = classifyDue("请于8月20日前提交", RECEIVED, "");
    expect(r.dueType).toBe("date_only");
    expect(r.startUtc).toBeNull();
  });
});

describe("D · unknown：绝不凭空生成钟点", () => {
  it("完全没有时间信息", () => {
    const r = classifyDue("我们已收到你的申请，请及时关注后续进展", RECEIVED, TZ);
    expect(r.dueType).toBe("unknown");
    expect(r.startUtc).toBeNull();
    expect(r.endUtc).toBeNull();
    expect(r.confidence).toBe("low");
  });

  it("空文本", () => {
    expect(classifyDue("", RECEIVED, TZ).dueType).toBe("unknown");
    expect(classifyDue("   ", RECEIVED, TZ).confidence).toBe("low");
  });

  it("验证码类噪音直接降级", () => {
    expect(classifyDue("一次性验证码 881310", RECEIVED, TZ).confidence).toBe("low");
    expect(classifyDue("Verify your Apple Careers email address.", RECEIVED, TZ).dueType).toBe(
      "unknown",
    );
    expect(classifyDue("Your verification code is 123456", RECEIVED, TZ).confidence).toBe("low");
  });

  it("收信时刻非法时不猜", () => {
    const r = classifyDue("72小时内完成", "不是时间", TZ);
    expect(r.dueType).toBe("unknown");
    expect(r.startUtc).toBeNull();
  });
});

describe("抗误报", () => {
  it("时长描述不会被当成钟点", () => {
    // 「限时40分钟」「约30-45分钟」「100分钟」都不是场次时刻
    const r = classifyDue("第一部分限时40分钟，约30-45分钟，共100分钟", RECEIVED, TZ);
    expect(r.dueType).toBe("unknown");
  });

  it("编号与年份不会被当成日期", () => {
    const r = classifyDue("京东2027校招-产品经理试卷-0815，岗位编号 200559112", RECEIVED, TZ);
    expect(r.dueType).toBe("unknown");
  });

  it("「3小时后过期」没有「内」字，不算截止期限", () => {
    const r = classifyDue("验证码发出后3小时过期", RECEIVED, TZ);
    // 命中噪音词，直接降级
    expect(r.confidence).toBe("low");
  });

  it("非法钟点被丢弃", () => {
    const r = classifyDue("编号 99:99 的记录", RECEIVED, TZ);
    expect(r.dueType).toBe("unknown");
  });

  it("非法月日被丢弃", () => {
    const r = classifyDue("批次 20月45日", RECEIVED, TZ);
    expect(r.dueType).toBe("unknown");
  });
});

describe("年份推断", () => {
  it("没写年份时用收信那年", () => {
    const r = classifyDue("8月22日 14:30 面试", RECEIVED, TZ);
    expect(r.startUtc?.startsWith("2026-08-22")).toBe(true);
  });

  it("12 月收信提到 1 月的场次，推断为下一年", () => {
    const received = "2026-12-20T02:00:00.000Z"; // 北京 12-20 10:00
    const r = classifyDue("1月5日 10:00 终面", received, TZ);
    expect(r.startUtc?.startsWith("2027-01-05")).toBe(true);
  });
});

describe("normalizeText", () => {
  it("全角折半", () => {
    expect(normalizeText("１０：００")).toBe("10:00");
  });
});

describe("classifyDueFromSignals：时区本身也是未知数时", () => {
  it("正文带显式时区，不用调用方另外告诉它 tz", () => {
    const r = classifyDueFromSignals(
      { text: "考试时间 2026-08-15 10:00-11:40（北京时间）" },
      RECEIVED,
    );
    expect(r.dueType).toBe("fixed_start");
    expect(r.startUtc).toBe("2026-08-15T02:00:00.000Z");
    expect(r.tzInference).toMatchObject({ tz: "Asia/Shanghai", source: "explicit" });
  });

  it("靠地点词推断，域名给的是国内 ATS 也一并佐证", () => {
    const r = classifyDueFromSignals(
      {
        text: "Role in Shenzhen. Please complete within 72 hours.",
        senderDomain: "recruit@mail.mokahr.com",
      },
      RECEIVED,
    );
    expect(r.dueType).toBe("deadline");
    expect(r.tzInference.source).toBe("location");
  });

  it("相对期限不依赖时区：完全没有信号也能算出正确的截止时刻", () => {
    const r = classifyDueFromSignals({ text: "请在72小时内完成测评" }, RECEIVED);
    expect(r.tzInference.tz).toBeNull();
    expect(r.dueType).toBe("deadline");
    // 与直接传 tz 时的结果一致：截止时刻本就不取决于时区
    expect(r.startUtc).toBe(classifyDue("请在72小时内完成测评", RECEIVED, "").startUtc);
    expect(r.startUtc).toBe("2026-08-18T04:03:00.000Z");
  });

  it("绝对时刻缺时区信号时，退化为 date_only 而不是编造", () => {
    const r = classifyDueFromSignals({ text: "面试时间：8月22日 14:30" }, RECEIVED);
    expect(r.tzInference.tz).toBeNull();
    expect(r.dueType).toBe("date_only");
    expect(r.startUtc).toBeNull();
    expect(r.reason).toContain("时区未知");
  });

  it("完全没有时间信息时仍然是 unknown", () => {
    const r = classifyDueFromSignals({ text: "感谢投递，我们会尽快联系您" }, RECEIVED);
    expect(r.dueType).toBe("unknown");
    expect(r.tzInference.source).toBe("none");
  });
});
