import { describe, expect, it } from "vitest";
import { normalizeText, parseChineseNumber, weekdayOf, isWeekend } from "../src/text.js";
import { findDates, resolveSlashOrder } from "../src/dateParse.js";
import { applyCnMeridiem, applyEnMeridiem, findTimes } from "../src/timeParse.js";
import { addBusinessDays, findRelativeDeadline } from "../src/relative.js";
import { findExplicitTimeZone } from "../src/timezone.js";

const REF = { year: 2026, date: "2026-08-15" };

describe("中文数字", () => {
  it("覆盖 0-99 的常见写法", () => {
    expect(parseChineseNumber("三")).toBe(3);
    expect(parseChineseNumber("两")).toBe(2);
    expect(parseChineseNumber("十")).toBe(10);
    expect(parseChineseNumber("十五")).toBe(15);
    expect(parseChineseNumber("二十")).toBe(20);
    expect(parseChineseNumber("二十三")).toBe(23);
    expect(parseChineseNumber("零")).toBe(0);
    expect(parseChineseNumber("7")).toBe(7);
  });

  it("认不出就返回 null，不猜", () => {
    expect(parseChineseNumber("")).toBeNull();
    expect(parseChineseNumber("若干")).toBeNull();
    expect(parseChineseNumber("百二")).toBeNull();
    expect(parseChineseNumber("一二三")).toBeNull();
    expect(parseChineseNumber("十百")).toBeNull();
  });
});

describe("normalizeText", () => {
  it("全角折半", () => {
    expect(normalizeText("１０：３０")).toBe("10:30");
    expect(normalizeText("８／１５")).toBe("8/15");
  });
});

describe("星期", () => {
  it("2026-08-27 是周四", () => {
    expect(weekdayOf(2026, 8, 27)).toBe(4);
    expect(isWeekend(2026, 8, 27)).toBe(false);
    expect(isWeekend(2026, 8, 15)).toBe(true); // 周六
    expect(isWeekend(2026, 8, 16)).toBe(true); // 周日
  });
});

describe("日期解析", () => {
  const parse = (text: string, ref = REF) => findDates(text, ref);

  it("中文与 ISO", () => {
    expect(parse("2026年8月15日")[0]).toMatchObject({ year: 2026, month: 8, day: 15 });
    expect(parse("2026-08-15")[0]).toMatchObject({ year: 2026, month: 8, day: 15 });
    expect(parse("8月20日")[0]).toMatchObject({ year: 2026, month: 8, day: 20 });
  });

  it("英文月在前 / 日在前", () => {
    expect(parse("August 20, 2026")[0]).toMatchObject({ month: 8, day: 20, year: 2026 });
    expect(parse("Aug 22")[0]).toMatchObject({ month: 8, day: 22, year: 2026 });
    expect(parse("15 Aug 2026")[0]).toMatchObject({ month: 8, day: 15, year: 2026 });
    expect(parse("Thursday, August 27")[0]).toMatchObject({ month: 8, day: 27 });
    expect(parse("27th September 2026")[0]).toMatchObject({ month: 9, day: 27 });
  });

  it("不会把年份的前两位读成日号", () => {
    // "Aug 2026" 里的 20 曾被读成 8月20日，是 c092 的失败原因
    const hits = parse("scheduled for 15 Aug 2026, 10:00");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ month: 8, day: 15, year: 2026 });
  });

  it("缺年份时补当年，早于收信则进位次年", () => {
    expect(parse("1月5日", { year: 2026, date: "2026-12-20" })[0]?.year).toBe(2027);
    expect(parse("December 25", { year: 2026, date: "2026-12-20" })[0]?.year).toBe(2026);
  });

  it("非法月日被丢弃", () => {
    expect(parse("20月45日")).toEqual([]);
    expect(parse("2月30日")).toEqual([]);
    expect(parse("26/27")).toEqual([]);
  });

  it("MMDD 必须有场次量词才算日期", () => {
    expect(parse("0815 场")[0]).toMatchObject({ month: 8, day: 15 });
    expect(parse("试卷-0815，")).toEqual([]);
    expect(parse("2027校招")).toEqual([]);
  });
});

describe("斜杠日期的日月顺序", () => {
  it("一方大于 12 时可唯一确定", () => {
    expect(resolveSlashOrder(20, 8)).toMatchObject({ month: 8, day: 20, ambiguous: false });
    expect(resolveSlashOrder(8, 15)).toMatchObject({ month: 8, day: 15, ambiguous: false });
  });

  it("两者都不超过 12 时标记歧义并给出另一解", () => {
    const r = resolveSlashOrder(8, 9);
    expect(r).toMatchObject({ month: 8, day: 9, ambiguous: true });
    expect(r?.alternative).toEqual({ month: 9, day: 8 });
  });

  it("两解都不成立时返回 null", () => {
    expect(resolveSlashOrder(26, 27)).toBeNull();
    expect(resolveSlashOrder(0, 0)).toBeNull();
  });
});

describe("12 小时制转换", () => {
  it("中文时段词", () => {
    expect(applyCnMeridiem(2, "下午")).toBe(14);
    expect(applyCnMeridiem(8, "晚上")).toBe(20);
    expect(applyCnMeridiem(6, "傍晚")).toBe(18);
    expect(applyCnMeridiem(10, "上午")).toBe(10);
    expect(applyCnMeridiem(5, "凌晨")).toBe(5);
    expect(applyCnMeridiem(10, undefined)).toBe(10);
  });

  it("12 点的三种含义各不相同", () => {
    expect(applyCnMeridiem(12, "中午")).toBe(12);
    expect(applyCnMeridiem(12, "凌晨")).toBe(0);
    expect(applyCnMeridiem(12, "下午")).toBe(12);
    expect(applyCnMeridiem(12, "上午")).toBe(12);
    expect(applyCnMeridiem(1, "中午")).toBe(13);
  });

  it("英文 AM/PM", () => {
    expect(applyEnMeridiem(2, "PM")).toBe(14);
    expect(applyEnMeridiem(11, "AM")).toBe(11);
    expect(applyEnMeridiem(12, "PM")).toBe(12);
    expect(applyEnMeridiem(12, "AM")).toBe(0);
    expect(applyEnMeridiem(9, "p.m.")).toBe(21);
    expect(applyEnMeridiem(9, undefined)).toBe(9);
  });
});

describe("钟点解析", () => {
  it("冒号钟点与区间", () => {
    const hits = findTimes("10:00-11:40");
    expect(hits[0]).toMatchObject({ hour: 10, minute: 0, endHour: 11, endMinute: 40 });
  });

  it("中文时段词 + 冒号钟点", () => {
    expect(findTimes("下午2:30")[0]).toMatchObject({ hour: 14, minute: 30 });
  });

  it("英文整点（无分钟）", () => {
    expect(findTimes("at 2 PM")[0]).toMatchObject({ hour: 14, minute: 0 });
    expect(findTimes("at 11 AM")[0]).toMatchObject({ hour: 11, minute: 0 });
  });

  it("中文钟点", () => {
    expect(findTimes("上午10点")[0]).toMatchObject({ hour: 10, minute: 0 });
    expect(findTimes("下午2点30分")[0]).toMatchObject({ hour: 14, minute: 30 });
  });

  it("24:00 归一化为当日 23:59，不是次日零点", () => {
    const hit = findTimes("8月20日24:00")[0];
    expect(hit).toMatchObject({ hour: 23, minute: 59, normalizedFromMidnight: true });
  });

  it("区间末端沿用前段的时段词", () => {
    expect(findTimes("下午2:30-4:00")[0]).toMatchObject({ hour: 14, endHour: 16 });
  });

  it("时长不会被当成钟点", () => {
    expect(findTimes("限时40分钟")).toEqual([]);
    expect(findTimes("Part 1: 40 minutes")).toEqual([]);
    expect(findTimes("45-minute video interview")).toEqual([]);
    expect(findTimes("约30-45分钟")).toEqual([]);
  });

  it("越界钟点被丢弃", () => {
    expect(findTimes("99:99")).toEqual([]);
    expect(findTimes("编号 25:00")).toEqual([]);
  });
});

describe("相对期限", () => {
  it("中文数字与单位", () => {
    expect(findRelativeDeadline("72小时内完成")).toMatchObject({ ms: 72 * 3600_000 });
    expect(findRelativeDeadline("三天内完成")).toMatchObject({ ms: 3 * 86400_000 });
    expect(findRelativeDeadline("两周内完成")).toMatchObject({ ms: 14 * 86400_000 });
    expect(findRelativeDeadline("十五日内完成")).toMatchObject({ ms: 15 * 86400_000 });
    expect(findRelativeDeadline("5个自然日内")).toMatchObject({ businessDays: false, count: 5 });
    expect(findRelativeDeadline("3个工作日内")).toMatchObject({ businessDays: true, count: 3 });
  });

  it("英文各种写法", () => {
    expect(findRelativeDeadline("within 48 hours")).toMatchObject({ ms: 48 * 3600_000 });
    expect(findRelativeDeadline("expire in 5 business days")).toMatchObject({
      businessDays: true,
      count: 5,
    });
    expect(findRelativeDeadline("complete in 3 days")).toMatchObject({ ms: 3 * 86400_000 });
    expect(findRelativeDeadline("5 days from receipt")).toMatchObject({ ms: 5 * 86400_000 });
    expect(findRelativeDeadline("within 2 weeks")).toMatchObject({ ms: 14 * 86400_000 });
  });

  it("「starts in N hours」是场次不是截止，单独标记 kind=start", () => {
    // 曾经直接丢弃。但召回率目标只有 70%，原始邀请常常没入库，
    // 丢掉这封提醒等于用户什么都得不到。改为算出来但降置信度。
    expect(findRelativeDeadline("your interview starts in 24 hours")).toMatchObject({
      kind: "start",
      ms: 24 * 3600_000,
    });
  });

  it("截止期限的 kind 是 deadline", () => {
    expect(findRelativeDeadline("expires in 5 business days")).toMatchObject({
      kind: "deadline",
    });
  });

  it("没有期限语气词时，裸 in N 不算截止", () => {
    expect(findRelativeDeadline("we will contact you in 3 days")).toBeNull();
  });

  it("多个期限取最紧的", () => {
    expect(findRelativeDeadline("7天内完成，其中第一部分24小时内")).toMatchObject({
      ms: 24 * 3600_000,
    });
  });

  it("没有期限时返回 null", () => {
    expect(findRelativeDeadline("请尽快完成")).toBeNull();
    expect(findRelativeDeadline("零天内")).toBeNull();
  });
});

describe("工作日推进", () => {
  it("周四 + 3 工作日 = 下周二，跳过周末", () => {
    // 2026-08-13 是周四，北京 10:00
    const result = addBusinessDays("2026-08-13T02:00:00.000Z", 3, "Asia/Shanghai");
    expect(result).toBe("2026-08-18T02:00:00.000Z");
  });

  it("周四 + 5 工作日 = 下周四", () => {
    const result = addBusinessDays("2026-08-13T14:00:00.000Z", 5, "America/New_York");
    expect(result).toBe("2026-08-20T14:00:00.000Z");
  });

  it("0 个工作日原地不动", () => {
    const from = "2026-08-13T02:00:00.000Z";
    expect(addBusinessDays(from, 0, "Asia/Shanghai")).toBe(from);
  });
});

describe("显式时区识别", () => {
  it("正文里写明的时区优先于推断", () => {
    expect(findExplicitTimeZone("10:00 (Beijing Time)")).toBe("Asia/Shanghai");
    expect(findExplicitTimeZone("北京时间 10:00")).toBe("Asia/Shanghai");
    expect(findExplicitTimeZone("2:30 PM SGT")).toBe("Asia/Singapore");
    expect(findExplicitTimeZone("（新加坡时间）")).toBe("Asia/Singapore");
    expect(findExplicitTimeZone("11:59 PM EST")).toBe("America/New_York");
    expect(findExplicitTimeZone("11:00 AM ET")).toBe("America/New_York");
    expect(findExplicitTimeZone("9:00 AM PST")).toBe("America/Los_Angeles");
    expect(findExplicitTimeZone("09:30 BST")).toBe("Europe/London");
    expect(findExplicitTimeZone("10:00 JST")).toBe("Asia/Tokyo");
    expect(findExplicitTimeZone("10:00 CET")).toBe("Europe/Berlin");
    expect(findExplicitTimeZone("香港时间 10:00")).toBe("Asia/Hong_Kong");
  });

  it("没写时区时返回 null", () => {
    expect(findExplicitTimeZone("考试时间 10:00")).toBeNull();
  });
});
