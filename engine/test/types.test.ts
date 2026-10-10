import { describe, expect, it } from "vitest";
import {
  CONFIDENCES,
  DUE_TYPES,
  EVENT_TYPES,
  coerceConfidence,
  coerceEventType,
  isConfidence,
  isConsistentDue,
  isDueType,
  isEventType,
} from "../src/types.js";

describe("枚举清单", () => {
  it("与类型定义一一对应", () => {
    expect(DUE_TYPES).toEqual(["fixed_start", "deadline", "date_only", "unknown"]);
    expect(EVENT_TYPES).toHaveLength(7);
    expect(CONFIDENCES).toEqual(["high", "medium", "low"]);
  });
});

describe("类型守卫 · 挡住 LLM 的脏输出", () => {
  it("认得合法值", () => {
    expect(isDueType("fixed_start")).toBe(true);
    expect(isEventType("assessment")).toBe(true);
    expect(isConfidence("high")).toBe(true);
  });

  it("拒绝大小写不符、拼错、非字符串", () => {
    expect(isDueType("Fixed_Start")).toBe(false);
    expect(isEventType("assessments")).toBe(false);
    expect(isEventType("OA")).toBe(false);
    expect(isConfidence(null)).toBe(false);
    expect(isDueType(42)).toBe(false);
    expect(isConfidence(undefined)).toBe(false);
  });
});

describe("兜底转换", () => {
  it("不认识的事件类型落到 other", () => {
    expect(coerceEventType("interview")).toBe("interview");
    expect(coerceEventType("OA")).toBe("other");
    expect(coerceEventType(null)).toBe("other");
  });

  it("不认识的置信度落到 low，宁可降级不误升", () => {
    expect(coerceConfidence("medium")).toBe("medium");
    expect(coerceConfidence("very-high")).toBe("low");
    expect(coerceConfidence(undefined)).toBe("low");
  });
});

describe("结构性不变量", () => {
  it("unknown 必须配 null，禁止凭空生成钟点", () => {
    expect(isConsistentDue("unknown", null)).toBe(true);
    expect(isConsistentDue("unknown", "2026-08-15T02:00:00.000Z")).toBe(false);
  });

  it("其余类型可以有时刻", () => {
    expect(isConsistentDue("fixed_start", "2026-08-15T02:00:00.000Z")).toBe(true);
    expect(isConsistentDue("date_only", null)).toBe(true);
  });
});
