import { describe, expect, it } from "vitest";
import { composeConfidence, confidenceFromRank, confidenceRank } from "../src/confidence.js";
import type { ConfidenceInputs } from "../src/confidence.js";
import type { TimeZoneInference } from "../src/timezone.js";

const TZ_OK: TimeZoneInference = {
  tz: "Asia/Shanghai",
  confidence: "high",
  source: "explicit",
  reason: "正文写明北京时间",
};
const TZ_NONE: TimeZoneInference = {
  tz: null,
  confidence: "low",
  source: "none",
  reason: "没有任何时区线索",
};

function inputs(over: Partial<ConfidenceInputs> = {}): ConfidenceInputs {
  return {
    eventType: "assessment",
    eventTypeConfidence: "high",
    dueType: "deadline",
    dueConfidence: "high",
    startUtc: "2026-08-14T13:34:00.000Z",
    hasCompany: true,
    companyMatched: true,
    tz: TZ_OK,
    truncated: false,
    usedEventTypeHint: false,
    notJobRelated: false,
    ...over,
  };
}

describe("composeConfidence 基准", () => {
  it("四路都干净时是 high", () => {
    expect(composeConfidence(inputs()).confidence).toBe("high");
  });

  it("事件类型不确定时整体跟着降", () => {
    expect(composeConfidence(inputs({ eventTypeConfidence: "low" })).confidence).toBe("low");
  });

  it("每一条降级都留下可读理由", () => {
    const r = composeConfidence(inputs({ companyMatched: false }));
    expect(r.confidence).toBe("medium");
    expect(r.reasons.join("")).toContain("别名表");
  });
});

describe("时间通道只在该有时间时才参与", () => {
  it("测评没解析出时间 → low，必须人工确认", () => {
    const r = composeConfidence(
      inputs({ eventType: "assessment", dueType: "unknown", dueConfidence: "low", startUtc: null }),
    );
    expect(r.confidence).toBe("low");
    expect(r.reasons.join("")).toContain("没有解析出任何时间");
  });

  it("面试没解析出时间 → 同样 low", () => {
    expect(
      composeConfidence(
        inputs({ eventType: "interview", dueType: "unknown", dueConfidence: "low", startUtc: null }),
      ).confidence,
    ).toBe("low");
  });

  it("「已收到你的申请」本来就没时间，不该因此降级", () => {
    const r = composeConfidence(
      inputs({
        eventType: "application_ok",
        dueType: "unknown",
        dueConfidence: "low",
        startUtc: null,
      }),
    );
    expect(r.confidence).toBe("high");
  });

  it("结果通知没时间同样保持 high", () => {
    expect(
      composeConfidence(
        inputs({ eventType: "result", dueType: "unknown", dueConfidence: "low", startUtc: null }),
      ).confidence,
    ).toBe("high");
  });

  it("update 缺时间不降级——否则待确认收件箱会被淹没", () => {
    expect(
      composeConfidence(
        inputs({ eventType: "update", dueType: "unknown", dueConfidence: "low", startUtc: null }),
      ).confidence,
    ).toBe("high");
  });

  it("非必备类别里解析出低可信时间：事件成立，但压到 medium", () => {
    const r = composeConfidence(
      inputs({ eventType: "update", dueType: "date_only", dueConfidence: "low" }),
    );
    expect(r.confidence).toBe("medium");
  });
});

describe("显式降级条款", () => {
  it("有时刻但时区未知 → medium，不能双时区显示", () => {
    const r = composeConfidence(inputs({ tz: TZ_NONE }));
    expect(r.confidence).toBe("medium");
    expect(r.reasons.join("")).toContain("双时区");
  });

  it("没时刻时时区未知无所谓", () => {
    expect(
      composeConfidence(
        inputs({ eventType: "result", dueType: "unknown", startUtc: null, tz: TZ_NONE }),
      ).confidence,
    ).toBe("high");
  });

  it("没解析出公司名 → low", () => {
    const r = composeConfidence(inputs({ hasCompany: false, companyMatched: false }));
    expect(r.confidence).toBe("low");
    expect(r.reasons.join("")).toContain("无法归属");
  });

  it("公司名没命中别名表 → 最高 medium", () => {
    expect(composeConfidence(inputs({ companyMatched: false })).confidence).toBe("medium");
  });

  it("正文被截断 → 最高 medium", () => {
    expect(composeConfidence(inputs({ truncated: true })).confidence).toBe("medium");
  });

  it("采纳了模型的类型建议 → 强制 low", () => {
    expect(composeConfidence(inputs({ usedEventTypeHint: true })).confidence).toBe("low");
  });

  it("模型判断与求职无关 → 强制 low", () => {
    expect(composeConfidence(inputs({ notJobRelated: true })).confidence).toBe("low");
  });

  it("多条降级同时生效时理由全部保留", () => {
    const r = composeConfidence(inputs({ companyMatched: false, truncated: true, tz: TZ_NONE }));
    expect(r.confidence).toBe("medium");
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("降级只降不升：low 的输入不会被任何条款抬回去", () => {
    expect(
      composeConfidence(inputs({ eventTypeConfidence: "low", companyMatched: true })).confidence,
    ).toBe("low");
  });
});

describe("置信度序号互转", () => {
  it("往返一致", () => {
    for (const c of ["low", "medium", "high"] as const) {
      expect(confidenceFromRank(confidenceRank(c))).toBe(c);
    }
  });

  it("越界序号取最低，不抛异常", () => {
    expect(confidenceFromRank(99)).toBe("low");
    expect(confidenceFromRank(-1)).toBe("low");
  });
});
