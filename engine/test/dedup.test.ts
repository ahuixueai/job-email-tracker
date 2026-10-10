import { describe, expect, it } from "vitest";
import type { ParsedEvent } from "../src/types.js";
import {
  buildDedupKey,
  dedupKeyOf,
  foldEvents,
  mergeEvent,
  targetDateOf,
  toStoredEvent,
} from "../src/dedup.js";

function parsed(over: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    company: "京东",
    companyMatched: true,
    eventType: "assessment",
    dueType: "fixed_start",
    startUtc: "2026-08-15T02:00:00.000Z",
    endUtc: null,
    sourceTimeZone: "Asia/Shanghai",
    confidence: "high",
    receivedAtUtc: "2026-08-13T08:02:00.000Z",
    sourceRef: "a",
    ...over,
  };
}

describe("buildDedupKey", () => {
  it("公司 + 事件类型 + 目标日期", () => {
    expect(buildDedupKey({ company: "京东", eventType: "assessment", targetDate: "2026-08-15" }))
      .toBe("京东|assessment|2026-08-15");
  });

  it("大小写与空白归一", () => {
    const a = buildDedupKey({ company: " KPMG ", eventType: "interview", targetDate: null });
    const b = buildDedupKey({ company: "kpmg", eventType: "interview", targetDate: null });
    expect(a).toBe(b);
  });

  it("没有日期时用固定占位，不会互相串", () => {
    expect(buildDedupKey({ company: "京东", eventType: "update", targetDate: null }))
      .toBe("京东|update|no-date");
  });
});

describe("targetDateOf", () => {
  it("按事件所在时区取日历日，不用 UTC 日", () => {
    const e = parsed({ startUtc: "2026-08-15T02:00:00.000Z", sourceTimeZone: "Asia/Shanghai" });
    expect(targetDateOf(e)).toBe("2026-08-15");
    // 同一时刻在纽约是前一天，分到不同的 key 是正确的
    expect(targetDateOf({ ...e, sourceTimeZone: "America/New_York" })).toBe("2026-08-14");
  });

  it("时区未知时退回 UTC 日", () => {
    expect(targetDateOf(parsed({ sourceTimeZone: null }))).toBe("2026-08-15");
  });

  it("没有时刻时为 null", () => {
    expect(targetDateOf(parsed({ startUtc: null }))).toBeNull();
  });
});

describe("mergeEvent · 计数", () => {
  it("同一件事的第二封邮件让 remindCount 递增而不是新建", () => {
    const stored = toStoredEvent(parsed());
    expect(stored.remindCount).toBe(1);
    const merged = mergeEvent(stored, parsed({ sourceRef: "b" }));
    expect(merged.remindCount).toBe(2);
    expect(merged.sourceRefs).toEqual(["a", "b"]);
  });

  it("重复的 sourceRef 不会被记两次", () => {
    const merged = mergeEvent(toStoredEvent(parsed()), parsed({ sourceRef: "a" }));
    expect(merged.sourceRefs).toEqual(["a"]);
    // 计数仍然加一：同一来源被重复投递也是一次催办
    expect(merged.remindCount).toBe(2);
  });
});

describe("mergeEvent · 精度冲突取高精度", () => {
  it("fixed_start 覆盖 deadline", () => {
    const stored = toStoredEvent(parsed({ dueType: "deadline", startUtc: "2026-08-18T04:03:00.000Z" }));
    const merged = mergeEvent(stored, parsed({ dueType: "fixed_start", startUtc: "2026-08-15T02:00:00.000Z" }));
    expect(merged.dueType).toBe("fixed_start");
    expect(merged.startUtc).toBe("2026-08-15T02:00:00.000Z");
  });

  it("deadline 覆盖 date_only", () => {
    const stored = toStoredEvent(parsed({ dueType: "date_only", startUtc: "2026-08-14T16:00:00.000Z" }));
    const merged = mergeEvent(stored, parsed({ dueType: "deadline", startUtc: "2026-08-14T13:34:00.000Z" }));
    expect(merged.dueType).toBe("deadline");
    expect(merged.startUtc).toBe("2026-08-14T13:34:00.000Z");
  });

  it("低精度不会覆盖高精度", () => {
    const stored = toStoredEvent(parsed({ dueType: "fixed_start" }));
    const merged = mergeEvent(stored, parsed({ dueType: "date_only", startUtc: "2026-08-14T16:00:00.000Z" }));
    expect(merged.dueType).toBe("fixed_start");
    expect(merged.startUtc).toBe("2026-08-15T02:00:00.000Z");
  });

  it("结束时刻随高精度一起更新", () => {
    const stored = toStoredEvent(parsed({ dueType: "date_only", startUtc: "2026-08-14T16:00:00.000Z" }));
    const merged = mergeEvent(
      stored,
      parsed({ dueType: "fixed_start", endUtc: "2026-08-15T03:40:00.000Z" }),
    );
    expect(merged.endUtc).toBe("2026-08-15T03:40:00.000Z");
  });
});

describe("mergeEvent · 不允许把已有时刻抹成空", () => {
  it("新的 startUtc 为 null 时保留旧值", () => {
    const stored = toStoredEvent(parsed());
    const merged = mergeEvent(stored, parsed({ dueType: "unknown", startUtc: null }));
    expect(merged.startUtc).toBe("2026-08-15T02:00:00.000Z");
    expect(merged.dueType).toBe("fixed_start");
    // 但催办次数照记
    expect(merged.remindCount).toBe(2);
  });

  it("旧值缺失、新值有时补上", () => {
    const stored = toStoredEvent(parsed({ dueType: "unknown", startUtc: null }));
    const merged = mergeEvent(stored, parsed({ dueType: "deadline", startUtc: "2026-08-18T04:03:00.000Z" }));
    expect(merged.startUtc).toBe("2026-08-18T04:03:00.000Z");
    expect(merged.dueType).toBe("deadline");
  });

  it("同精度且旧值缺失时也补", () => {
    const stored = toStoredEvent(parsed({ dueType: "unknown", startUtc: null }));
    const merged = mergeEvent(stored, parsed({ dueType: "unknown", startUtc: null }));
    expect(merged.startUtc).toBeNull();
  });
});

describe("mergeEvent · 时间戳与元信息", () => {
  it("firstSeenUtc 取最早，lastSeenUtc 取最新", () => {
    const stored = toStoredEvent(parsed({ receivedAtUtc: "2026-08-13T08:02:00.000Z" }));
    const later = mergeEvent(stored, parsed({ receivedAtUtc: "2026-08-14T09:47:00.000Z" }));
    expect(later.firstSeenUtc).toBe("2026-08-13T08:02:00.000Z");
    expect(later.lastSeenUtc).toBe("2026-08-14T09:47:00.000Z");

    // 乱序到达也要正确
    const earlier = mergeEvent(later, parsed({ receivedAtUtc: "2026-08-12T00:00:00.000Z" }));
    expect(earlier.firstSeenUtc).toBe("2026-08-12T00:00:00.000Z");
    expect(earlier.lastSeenUtc).toBe("2026-08-14T09:47:00.000Z");
  });

  it("置信度只升不降", () => {
    const stored = toStoredEvent(parsed({ confidence: "low" }));
    expect(mergeEvent(stored, parsed({ confidence: "high" })).confidence).toBe("high");
    const high = toStoredEvent(parsed({ confidence: "high" }));
    expect(mergeEvent(high, parsed({ confidence: "low" })).confidence).toBe("high");
  });

  it("公司名归一化成功过就不退回原名", () => {
    const stored = toStoredEvent(parsed({ company: "KPMG", companyMatched: false }));
    const merged = mergeEvent(stored, parsed({ company: "毕马威", companyMatched: true }));
    expect(merged.company).toBe("毕马威");
    expect(merged.companyMatched).toBe(true);

    const matchedFirst = toStoredEvent(parsed({ company: "毕马威", companyMatched: true }));
    expect(mergeEvent(matchedFirst, parsed({ company: "KPMG", companyMatched: false })).company)
      .toBe("毕马威");
  });

  it("时区缺失时由后来者补上", () => {
    const stored = toStoredEvent(parsed({ sourceTimeZone: null }));
    expect(mergeEvent(stored, parsed()).sourceTimeZone).toBe("Asia/Shanghai");
  });

  it("sourceRef 为 null 时不写入", () => {
    const stored = toStoredEvent(parsed({ sourceRef: null }));
    expect(stored.sourceRefs).toEqual([]);
    expect(mergeEvent(stored, parsed({ sourceRef: null })).sourceRefs).toEqual([]);
  });
});

describe("foldEvents", () => {
  it("把一批解析结果折叠成去重列表", () => {
    const folded = foldEvents([
      parsed({ sourceRef: "1" }),
      parsed({ sourceRef: "2" }), // 同一件事
      parsed({ company: "毕马威", dueType: "deadline", startUtc: "2026-08-18T04:03:00.000Z", sourceRef: "3" }),
    ]);
    expect(folded).toHaveLength(2);
    const jd = folded.find((e) => e.company === "京东");
    expect(jd?.remindCount).toBe(2);
  });

  it("顺序无关：先低精度后高精度，结果仍取高精度", () => {
    // 两条的目标日期在上海都是 8-15（16:00Z = 次日 00:00 北京），属同一件事
    const lowFirst = foldEvents([
      parsed({ dueType: "date_only", startUtc: "2026-08-14T16:00:00.000Z", sourceRef: "1" }),
      parsed({ dueType: "fixed_start", sourceRef: "2" }),
    ]);
    expect(lowFirst).toHaveLength(1);
    expect(lowFirst[0]?.dueType).toBe("fixed_start");
    expect(lowFirst[0]?.startUtc).toBe("2026-08-15T02:00:00.000Z");
    expect(lowFirst[0]?.remindCount).toBe(2);

    const highFirst = foldEvents([
      parsed({ dueType: "fixed_start", sourceRef: "2" }),
      parsed({ dueType: "date_only", startUtc: "2026-08-14T16:00:00.000Z", sourceRef: "1" }),
    ]);
    expect(highFirst[0]?.dueType).toBe("fixed_start");
    expect(highFirst[0]?.startUtc).toBe("2026-08-15T02:00:00.000Z");
  });

  it("空输入返回空数组", () => {
    expect(foldEvents([])).toEqual([]);
  });
});

describe("dedupKeyOf", () => {
  it("同公司同类型同日期即同 key", () => {
    expect(dedupKeyOf(parsed({ sourceRef: "x" }))).toBe(dedupKeyOf(parsed({ sourceRef: "y" })));
  });

  it("事件类型不同则不同 key", () => {
    expect(dedupKeyOf(parsed())).not.toBe(dedupKeyOf(parsed({ eventType: "interview" })));
  });
});
