import { describe, expect, test } from "vitest";
import {
  MAX_PRIORITY_SCORE,
  calcPriority,
  isHighPriority,
  isSettled,
  sortByPriority,
  urgencyScore,
} from "@/lib/priority";
import { NOW, hoursFromNow, makeInterview } from "./helpers";

describe("urgencyScore 分档边界", () => {
  test.each([
    [-5, 5, "已开始视为最紧急"],
    [0, 5, "刚好开始"],
    [23.9, 5, "24 小时内"],
    [24, 4, "24 小时整落入下一档"],
    [71.9, 4, "72 小时内"],
    [72, 3, "72 小时整落入下一档"],
    [24 * 7 - 0.1, 3, "一周内"],
    [24 * 7, 2, "一周整落入下一档"],
    [24 * 14 - 0.1, 2, "两周内"],
    [24 * 14, 1, "两周以上"],
  ])("距开始 %s 小时 → %i（%s）", (hours, expected) => {
    expect(urgencyScore(hours)).toBe(expected);
  });
});

describe("calcPriority", () => {
  test("紧急度权重高于重要度：明天的普通面试压过三周后的梦中情司", () => {
    const 明天普通 = makeInterview({
      id: "明天普通",
      importance: 1,
      startUtc: hoursFromNow(20),
    });
    const 三周后梦中情司 = makeInterview({
      id: "三周后梦中情司",
      importance: 5,
      startUtc: hoursFromNow(24 * 21),
    });

    expect(calcPriority(明天普通, NOW)).toBeGreaterThan(
      calcPriority(三周后梦中情司, NOW),
    );
  });

  test("满分是 125：重要度 5 且 24 小时内", () => {
    const 满分 = makeInterview({ id: "x", importance: 5, startUtc: hoursFromNow(1) });
    expect(calcPriority(满分, NOW)).toBe(MAX_PRIORITY_SCORE);
  });

  test("最低分 25：重要度 1 且两周开外", () => {
    const 最低 = makeInterview({ id: "x", importance: 1, startUtc: hoursFromNow(24 * 30) });
    expect(calcPriority(最低, NOW)).toBe(25);
  });
});

describe("isHighPriority", () => {
  test("100 分是门槛，含 100", () => {
    expect(isHighPriority(99)).toBe(false);
    expect(isHighPriority(100)).toBe(true);
  });
});

describe("isSettled", () => {
  test.each([
    ["offer", true],
    ["rejected", true],
    ["scheduled", false],
    ["completed", false],
  ])("%s → %s", (status, expected) => {
    expect(isSettled(makeInterview({ id: "x", status: status as never }))).toBe(expected);
  });
});

describe("sortByPriority", () => {
  test("终态一律沉底，哪怕它马上就开始", () => {
    const items = [
      makeInterview({ id: "已拿offer", status: "offer", startUtc: hoursFromNow(1) }),
      makeInterview({ id: "还没开始", startUtc: hoursFromNow(24 * 20) }),
    ];
    expect(sortByPriority(items, NOW).map((i) => i.id)).toEqual([
      "还没开始",
      "已拿offer",
    ]);
  });

  test("同分时按开始时间升序兜底", () => {
    const items = [
      makeInterview({ id: "晚", startUtc: hoursFromNow(20) }),
      makeInterview({ id: "早", startUtc: hoursFromNow(2) }),
    ];
    expect(sortByPriority(items, NOW).map((i) => i.id)).toEqual(["早", "晚"]);
  });

  test("不修改入参数组", () => {
    const items = [
      makeInterview({ id: "b", startUtc: hoursFromNow(24 * 20) }),
      makeInterview({ id: "a", startUtc: hoursFromNow(1) }),
    ];
    const before = items.map((i) => i.id);

    sortByPriority(items, NOW);

    expect(items.map((i) => i.id)).toEqual(before);
  });

  test("同一批数据在不同的 now 下顺序会变", () => {
    const items = [
      makeInterview({ id: "低分近期", importance: 1, startUtc: hoursFromNow(10) }),
      makeInterview({ id: "高分远期", importance: 5, startUtc: hoursFromNow(24 * 20) }),
    ];

    // 此刻「低分近期」10 小时后就开始，排前面
    expect(sortByPriority(items, NOW).map((i) => i.id)).toEqual([
      "低分近期",
      "高分远期",
    ]);
    // 把 now 往前拨一个月，它变成一个月后的事，让位给高重要度那张
    expect(
      sortByPriority(items, NOW - 24 * 30 * 3_600_000).map((i) => i.id),
    ).toEqual(["高分远期", "低分近期"]);
  });

  test("空数组不炸", () => {
    expect(sortByPriority([], NOW)).toEqual([]);
  });
});
