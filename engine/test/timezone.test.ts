import { describe, expect, it } from "vitest";
import {
  formatDual,
  isSameZone,
  isValidTimeZone,
  localDateIn,
  parseWallClock,
  regionToTimeZone,
  wallClockToUtc,
  zoneAbbr,
  zoneOffsetMinutes,
} from "../src/timezone.js";

describe("regionToTimeZone", () => {
  it("覆盖方案里列出的地区", () => {
    expect(regionToTimeZone("国内")).toBe("Asia/Shanghai");
    expect(regionToTimeZone("中国")).toBe("Asia/Shanghai");
    expect(regionToTimeZone("China")).toBe("Asia/Shanghai");
    expect(regionToTimeZone("香港")).toBe("Asia/Hong_Kong");
    expect(regionToTimeZone("Hong Kong")).toBe("Asia/Hong_Kong");
    expect(regionToTimeZone("新加坡")).toBe("Asia/Singapore");
    expect(regionToTimeZone("Singapore")).toBe("Asia/Singapore");
    expect(regionToTimeZone("中东")).toBe("Asia/Dubai");
    expect(regionToTimeZone("Middle East")).toBe("Asia/Dubai");
    expect(regionToTimeZone("美国")).toBe("America/New_York");
    expect(regionToTimeZone("US")).toBe("America/New_York");
    expect(regionToTimeZone("欧洲")).toBe("Europe/London");
    expect(regionToTimeZone("英国")).toBe("Europe/London");
    expect(regionToTimeZone("Europe")).toBe("Europe/London");
  });

  it("大小写与空白不敏感", () => {
    expect(regionToTimeZone("  SINGAPORE  ")).toBe("Asia/Singapore");
  });

  it("未知地区返回 null，绝不默认成上海", () => {
    // 默认一个错时区比承认不知道危险得多：用户会看到自信但错误的时刻
    expect(regionToTimeZone("火星")).toBeNull();
    expect(regionToTimeZone("")).toBeNull();
    expect(regionToTimeZone("   ")).toBeNull();
  });
});

describe("wallClockToUtc", () => {
  it("北京墙上时间换算成 UTC", () => {
    expect(wallClockToUtc("2026-08-15 10:00", "Asia/Shanghai")).toBe(
      "2026-08-15T02:00:00.000Z",
    );
  });

  it("接受 T 分隔、带秒、以及只有日期的写法", () => {
    expect(wallClockToUtc("2026-08-15T10:00:00", "Asia/Shanghai")).toBe(
      "2026-08-15T02:00:00.000Z",
    );
    expect(wallClockToUtc("2026-08-15", "Asia/Shanghai")).toBe(
      "2026-08-14T16:00:00.000Z",
    );
  });

  it("同一墙上时间在伦敦：1 月是 GMT，7 月是 BST", () => {
    // DST 断言。手写偏移的实现会在这里出错，Intl 不会。
    const winter = wallClockToUtc("2026-01-15 10:00", "Europe/London");
    const summer = wallClockToUtc("2026-07-15 10:00", "Europe/London");
    expect(winter).toBe("2026-01-15T10:00:00.000Z"); // GMT，偏移 0
    expect(summer).toBe("2026-07-15T09:00:00.000Z"); // BST，偏移 +1
    expect(zoneAbbr(winter, "Europe/London")).toBe("GMT");
    expect(zoneAbbr(summer, "Europe/London")).toBe("BST");
    expect(zoneOffsetMinutes(new Date(winter), "Europe/London")).toBe(0);
    expect(zoneOffsetMinutes(new Date(summer), "Europe/London")).toBe(60);
  });

  it("纽约同样跨夏令时", () => {
    expect(wallClockToUtc("2026-01-15 10:00", "America/New_York")).toBe(
      "2026-01-15T15:00:00.000Z",
    );
    expect(wallClockToUtc("2026-07-15 10:00", "America/New_York")).toBe(
      "2026-07-15T14:00:00.000Z",
    );
  });

  it("非法输入直接抛，不静默返回错误时刻", () => {
    expect(() => wallClockToUtc("下周三", "Asia/Shanghai")).toThrow(/无法解析/);
    expect(() => wallClockToUtc("2026-08-15", "Mars/Olympus")).toThrow(/IANA/);
  });
});

describe("parseWallClock", () => {
  it("解析各种写法", () => {
    expect(parseWallClock("2026-08-15 10:30:45")).toEqual({
      year: 2026,
      month: 8,
      day: 15,
      hour: 10,
      minute: 30,
      second: 45,
    });
    expect(parseWallClock("2026-08-15")?.hour).toBe(0);
  });

  it("解析不了返回 null", () => {
    expect(parseWallClock("八月十五")).toBeNull();
  });
});

describe("localDateIn", () => {
  it("跨时区判「哪一天」必须按当地日历日", () => {
    const utc = "2026-08-15T02:00:00.000Z";
    expect(localDateIn(utc, "Asia/Shanghai")).toBe("2026-08-15");
    // 同一时刻在纽约还是前一天
    expect(localDateIn(utc, "America/New_York")).toBe("2026-08-14");
  });
});

describe("isValidTimeZone", () => {
  it("认得真时区，拒绝假的", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Nowhere/Nothing")).toBe(false);
  });
});

describe("isSameZone", () => {
  const utc = "2026-08-15T02:00:00.000Z";
  it("同名视为同区", () => {
    expect(isSameZone(utc, "Asia/Shanghai", "Asia/Shanghai")).toBe(true);
  });
  it("别名同区也认（Asia/Chongqing 与 Asia/Shanghai）", () => {
    expect(isSameZone(utc, "Asia/Shanghai", "Asia/Chongqing")).toBe(true);
  });
  it("真跨区不认", () => {
    expect(isSameZone(utc, "Asia/Shanghai", "America/New_York")).toBe(false);
  });
});

describe("formatDual", () => {
  it("跨区时两边都渲染，并标出缩写", () => {
    const dual = formatDual("2026-08-15T02:00:00.000Z", "Asia/Shanghai", "America/New_York");
    expect(dual.sameZone).toBe(false);
    expect(dual.source).toMatch(/10:00/);
    expect(dual.viewer).toMatch(/22:00/);
    expect(dual.viewer).toMatch(/EDT/);
  });

  it("同区时 viewer 与 source 完全相同，UI 不该重复渲染", () => {
    const dual = formatDual("2026-08-15T02:00:00.000Z", "Asia/Shanghai", "Asia/Shanghai");
    expect(dual.sameZone).toBe(true);
    expect(dual.viewer).toBe(dual.source);
  });
});

describe("zoneAbbr", () => {
  it("按候选 locale 链取字母缩写", () => {
    // 单一 locale 拿不全：en-US 下伦敦是 GMT+1，en-GB 下纽约是 GMT-4
    expect(zoneAbbr("2026-08-15T02:00:00.000Z", "America/New_York")).toBe("EDT");
    expect(zoneAbbr("2026-01-15T02:00:00.000Z", "America/New_York")).toBe("EST");
    expect(zoneAbbr("2026-07-15T09:00:00.000Z", "Europe/London")).toBe("BST");
  });

  it("没有字母缩写的时区保留 GMT±N 形式", () => {
    expect(zoneAbbr("2026-08-15T02:00:00.000Z", "Asia/Shanghai")).toMatch(/GMT\+8/);
  });
});
