import { describe, expect, test } from "vitest";
import {
  formatCountdown,
  formatDuration,
  isSameZone,
  normalizeTimeZone,
  toZonedTime,
  utcFromZonedWallClock,
  zoneOffsetMinutes,
} from "@/lib/time";

describe("normalizeTimeZone", () => {
  test("放行真实 IANA 名", () => {
    expect(normalizeTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(normalizeTimeZone("America/New_York")).toBe("America/New_York");
    expect(normalizeTimeZone("UTC")).toBe("UTC");
  });

  test("挡掉不存在的时区", () => {
    expect(normalizeTimeZone("Asia/火星")).toBeNull();
    expect(normalizeTimeZone("Not/AZone")).toBeNull();
  });

  test("挡掉注入型与超长输入", () => {
    expect(normalizeTimeZone("<script>alert(1)</script>")).toBeNull();
    expect(normalizeTimeZone("';DROP TABLE--")).toBeNull();
    expect(normalizeTimeZone("A".repeat(65))).toBeNull();
  });

  test("空值返回 null", () => {
    expect(normalizeTimeZone("")).toBeNull();
    expect(normalizeTimeZone(null)).toBeNull();
    expect(normalizeTimeZone(undefined)).toBeNull();
  });
});

describe("zoneOffsetMinutes 与夏令时", () => {
  test("上海全年 +480，没有夏令时", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T00:00:00Z"), "Asia/Shanghai")).toBe(480);
    expect(zoneOffsetMinutes(new Date("2026-07-15T00:00:00Z"), "Asia/Shanghai")).toBe(480);
  });

  test("纽约冬夏偏移不同：EST -300 / EDT -240", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "America/New_York")).toBe(-240);
  });

  test("印度是半小时偏移 +330", () => {
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Asia/Kolkata")).toBe(330);
  });
});

describe("utcFromZonedWallClock", () => {
  test("上海墙上时间换 UTC", () => {
    expect(
      utcFromZonedWallClock({ year: 2026, month: 9, day: 15, hour: 14, minute: 30 }, "Asia/Shanghai"),
    ).toBe("2026-09-15T06:30:00.000Z");
  });

  test("夏令时期间的纽约（EDT，-4）", () => {
    expect(
      utcFromZonedWallClock({ year: 2026, month: 7, day: 15, hour: 9 }, "America/New_York"),
    ).toBe("2026-07-15T13:00:00.000Z");
  });

  test("冬令时期间的纽约（EST，-5）", () => {
    expect(
      utcFromZonedWallClock({ year: 2026, month: 1, day: 15, hour: 9 }, "America/New_York"),
    ).toBe("2026-01-15T14:00:00.000Z");
  });

  /**
   * 2026-03-08 纽约 02:00 跳到 03:00。下午 2 点已经在 EDT 里，
   * 单次换算会用切换前的偏移算错一小时——迭代两次就是为了这个。
   */
  test("夏令时切换当天下午仍然正确", () => {
    expect(
      utcFromZonedWallClock({ year: 2026, month: 3, day: 8, hour: 14 }, "America/New_York"),
    ).toBe("2026-03-08T18:00:00.000Z");
  });

  test("换算结果回投影回原时区能对上", () => {
    const utc = utcFromZonedWallClock(
      { year: 2026, month: 11, day: 1, hour: 10, minute: 15 },
      "Europe/London",
    );
    expect(toZonedTime(utc, "Europe/London").time).toBe("10:15");
  });
});

describe("toZonedTime", () => {
  test("同一时刻在不同时区显示不同的钟点", () => {
    const utc = "2026-09-15T06:30:00.000Z";
    expect(toZonedTime(utc, "Asia/Shanghai").time).toBe("14:30");
    expect(toZonedTime(utc, "Europe/London").time).toBe("07:30");
    expect(toZonedTime(utc, "America/New_York").time).toBe("02:30");
  });

  /**
   * CLDR 只在本地区 locale 给字母缩写。单用 en-US 拿不到 BST，
   * 单用 en-GB 拿不到 EDT——所以实现走 ["en-US","en-GB"] 候选链。
   */
  test("能拿到美国和英国各自的字母缩写", () => {
    expect(toZonedTime("2026-07-15T12:00:00Z", "America/New_York").abbr).toBe("EDT");
    expect(toZonedTime("2026-01-15T12:00:00Z", "America/New_York").abbr).toBe("EST");
    expect(toZonedTime("2026-07-15T12:00:00Z", "Europe/London").abbr).toBe("BST");
  });

  test("没有字母缩写的时区保留 GMT±N 写法", () => {
    expect(toZonedTime("2026-07-15T12:00:00Z", "Asia/Shanghai").abbr).toMatch(/GMT\+8/);
  });

  test("带上 IANA 名本身", () => {
    expect(toZonedTime("2026-07-15T12:00:00Z", "Asia/Tokyo").zone).toBe("Asia/Tokyo");
  });
});

describe("isSameZone", () => {
  test("同名是同一个", () => {
    expect(isSameZone("Asia/Shanghai", "Asia/Shanghai")).toBe(true);
  });

  test("别名当下偏移相同也算同一个", () => {
    expect(isSameZone("Asia/Shanghai", "Asia/Chongqing")).toBe(true);
  });

  test("偏移不同就不是", () => {
    expect(isSameZone("Asia/Shanghai", "Asia/Tokyo")).toBe(false);
  });
});

describe("formatDuration", () => {
  test.each([
    ["2026-09-15T06:00:00Z", "2026-09-15T06:45:00Z", "45 分钟"],
    ["2026-09-15T06:00:00Z", "2026-09-15T07:00:00Z", "1 小时"],
    ["2026-09-15T06:00:00Z", "2026-09-15T07:30:00Z", "1 小时 30 分钟"],
  ])("%s → %s = %s", (start, end, expected) => {
    expect(formatDuration(start, end)).toBe(expected);
  });
});

describe("formatCountdown", () => {
  const start = Date.parse("2026-09-15T06:00:00Z");
  const at = (offsetMinutes: number) => start - offsetMinutes * 60_000;

  test.each([
    [-1, "已开始"],
    [0, "0 分钟后"],
    [25, "25 分钟后"],
    [60, "1 小时后"],
    [60 * 23, "23 小时后"],
    [60 * 24, "1 天后"],
    [60 * 24 * 13, "13 天后"],
    [60 * 24 * 14, "2 周后"],
  ])("提前 %i 分钟 → %s", (offset, expected) => {
    expect(formatCountdown("2026-09-15T06:00:00Z", at(offset))).toBe(expected);
  });
});
