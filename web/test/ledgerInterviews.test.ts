import { describe, expect, test } from "vitest";
import {
  LIVE_STATUS,
  LEDGER_SUB_CALENDAR_ID,
  tzOf,
  parseWhen,
  pickWhen,
  buildLedgerInterviews,
  type LedgerAppRow,
} from "@/lib/ledgerInterviews";

function row(p: Partial<LedgerAppRow> = {}): LedgerAppRow {
  return {
    id: 1,
    company: "测试公司",
    role: "分析师",
    region: "深圳",
    status: "oa",
    next_due: null,
    deadline: null,
    next_action: null,
    ...p,
  };
}

describe("LIVE_STATUS 与 export_ics.py 的 LIVE_STATUS 对齐", () => {
  test("只有 oa / applied / phone 三种", () => {
    expect([...LIVE_STATUS]).toEqual(["oa", "applied", "phone"]);
  });
});

describe("tzOf：region 关键词 → 时区", () => {
  test("命中国内关键词 → Asia/Shanghai，tzOk=true", () => {
    expect(tzOf("深圳")).toEqual({ tz: "Asia/Shanghai", tzOk: true });
    expect(tzOf("China")).toEqual({ tz: "Asia/Shanghai", tzOk: true });
  });

  test("香港与新加坡都映射到 Asia/Singapore（与 export_ics.py 一致，不做修正）", () => {
    expect(tzOf("香港")).toEqual({ tz: "Asia/Singapore", tzOk: true });
    expect(tzOf("新加坡")).toEqual({ tz: "Asia/Singapore", tzOk: true });
  });

  test("中东/美国关键词命中对应时区", () => {
    expect(tzOf("迪拜")).toEqual({ tz: "Asia/Dubai", tzOk: true });
    expect(tzOf("纽约")).toEqual({ tz: "America/New_York", tzOk: true });
  });

  test("推不出来 → 兜底 Asia/Shanghai，但 tzOk=false（必须显式可见，不能静默兜底）", () => {
    expect(tzOf("火星")).toEqual({ tz: "Asia/Shanghai", tzOk: false });
    expect(tzOf(null)).toEqual({ tz: "Asia/Shanghai", tzOk: false });
    expect(tzOf("")).toEqual({ tz: "Asia/Shanghai", tzOk: false });
  });
});

describe("parseWhen：三种解析结果", () => {
  test("带显式偏移：原样采信，不再推断时区", () => {
    const r = parseWhen("2026-08-23T14:00:00+08:00", "America/New_York");
    expect(r.kind).toBe("timed");
    if (r.kind === "timed") {
      expect(new Date(r.utcMs).toISOString()).toBe("2026-08-23T06:00:00.000Z");
    }
  });

  test("带显式偏移（无冒号写法 +0800）也能解析", () => {
    const r = parseWhen("2026-08-23T14:00:00+0800", "America/New_York");
    expect(r.kind).toBe("timed");
    if (r.kind === "timed") {
      expect(new Date(r.utcMs).toISOString()).toBe("2026-08-23T06:00:00.000Z");
    }
  });

  test("裸时间：按传入 tz 解释", () => {
    const r = parseWhen("2026-08-23 14:00:00", "Asia/Shanghai");
    expect(r.kind).toBe("timed");
    if (r.kind === "timed") {
      expect(new Date(r.utcMs).toISOString()).toBe("2026-08-23T06:00:00.000Z");
    }
  });

  test("只有日期 → date 类型", () => {
    const r = parseWhen("2026-08-27", "Asia/Shanghai");
    expect(r).toEqual({ kind: "date", year: 2026, month: 8, day: 27 });
  });

  test("解析不出来的自由文本 → none", () => {
    expect(parseWhen("2026年8月起网申", "Asia/Shanghai")).toEqual({ kind: "none" });
  });

  test("null / 空字符串 → none", () => {
    expect(parseWhen(null, "Asia/Shanghai")).toEqual({ kind: "none" });
    expect(parseWhen("  ", "Asia/Shanghai")).toEqual({ kind: "none" });
  });
});

describe("pickWhen：两个时间字段挑一个", () => {
  const tz = "Asia/Shanghai";
  const now = Date.parse("2026-08-20T00:00:00Z");

  test("两个都在未来 → 取更早的（截止日优先于软性 next_due）", () => {
    const pick = pickWhen("2026-08-27", "2026-08-23", tz, now);
    expect(pick?.source).toBe("deadline");
    expect(pick?.overdue).toBe(false);
  });

  test("更早的已过期 → 用还在未来的那个", () => {
    const pastNow = Date.parse("2026-08-15T00:00:00Z");
    const pick = pickWhen("2026-08-27", "2026-08-14", tz, pastNow);
    expect(pick?.source).toBe("next_due");
    expect(pick?.overdue).toBe(false);
  });

  test("两个都过期 → 取最近的那个，标 overdue", () => {
    const future = Date.parse("2026-09-01T00:00:00Z");
    const pick = pickWhen("2026-08-14", "2026-08-20", tz, future);
    expect(pick?.source).toBe("deadline");
    expect(pick?.overdue).toBe(true);
  });

  test("只有一个字段有值就用那个", () => {
    const pick = pickWhen(null, "2026-08-27", tz, now);
    expect(pick?.source).toBe("deadline");
  });

  test("两个都解析不出来 → null", () => {
    expect(pickWhen("2026年网申", null, tz, now)).toBeNull();
  });

  test("date 类型按「当天结束才算过期」判断——deadline 当天不算逾期", () => {
    // deadline 是今天，due_moment = 明天 00:00，>= now，所以还没过期
    const today = Date.parse("2026-08-27T10:00:00Z");
    const pick = pickWhen(null, "2026-08-27", "UTC", today);
    expect(pick?.overdue).toBe(false);
  });
});

describe("buildLedgerInterviews：选出的行 → Interview", () => {
  const now = Date.parse("2026-08-20T00:00:00Z");

  test("timed 事件：1 小时时长，标准字段填好", () => {
    const [itv] = buildLedgerInterviews(
      [row({ id: 60, company: "阿里巴巴", role: "在线笔试", region: "杭州", status: "oa", next_due: "2026-08-23T14:00:00+08:00" })],
      { now },
    );
    expect(itv.id).toBe("ledger-60");
    expect(itv.externalId).toBe("ledger-60");
    expect(itv.source).toBe("ledger");
    expect(itv.subCalendarId).toBe(LEDGER_SUB_CALENDAR_ID);
    expect(itv.startUtc).toBe("2026-08-23T06:00:00.000Z");
    expect(itv.endUtc).toBe("2026-08-23T07:00:00.000Z");
    expect(itv.type).toBe("assessment");
    expect(itv.position).toBe("在线笔试");
  });

  test("date 类型事件：全天（region=深圳 → Asia/Shanghai 当天 00:00），结束时间是次日", () => {
    const [itv] = buildLedgerInterviews(
      [row({ status: "applied", deadline: "2026-08-27" })],
      { now },
    );
    // 2026-08-27 00:00 Asia/Shanghai = 2026-08-26T16:00:00.000Z
    expect(itv.startUtc).toBe("2026-08-26T16:00:00.000Z");
    expect(new Date(itv.endUtc).getTime() - new Date(itv.startUtc).getTime()).toBe(
      24 * 60 * 60_000,
    );
  });

  test("region 推不出时区 → position 带「时区待确认」，可见不隐藏", () => {
    const [itv] = buildLedgerInterviews(
      [row({ region: "火星", next_due: "2026-08-27" })],
      { now },
    );
    expect(itv.position).toContain("时区待确认");
  });

  describe("timePrecision 与 sourceTimeZoneConfirmed：两个独立维度都要如实传出去", () => {
    // 这是本轮修的 bug 本体：pick.kind 和 tzOk 算出来之后曾经直接被丢掉，
    // 展示层拿不到就只能一律当成「timed + 已确认」来画，等于把「不知道」画成「知道」。
    test("timed + region 推得出 → timePrecision timed，sourceTimeZoneConfirmed true", () => {
      const [itv] = buildLedgerInterviews(
        [row({ region: "深圳", next_due: "2026-08-23T14:00:00+08:00" })],
        { now },
      );
      expect(itv.timePrecision).toBe("timed");
      expect(itv.sourceTimeZoneConfirmed).toBe(true);
    });

    test("timed + region 推不出 → timePrecision timed，sourceTimeZoneConfirmed false", () => {
      const [itv] = buildLedgerInterviews(
        [row({ region: "火星", next_due: "2026-08-23T14:00:00+08:00" })],
        { now },
      );
      expect(itv.timePrecision).toBe("timed");
      expect(itv.sourceTimeZoneConfirmed).toBe(false);
    });

    test("只有日期 + region 推得出 → timePrecision date，sourceTimeZoneConfirmed true（这条之前也被当成 timed 00:00 渲染，同样是 bug）", () => {
      const [itv] = buildLedgerInterviews(
        [row({ region: "深圳", next_due: "2026-08-27" })],
        { now },
      );
      expect(itv.timePrecision).toBe("date");
      expect(itv.sourceTimeZoneConfirmed).toBe(true);
    });

    test("只有日期 + region 推不出 → timePrecision date，sourceTimeZoneConfirmed false（原 bug 复现场景：东风/京东/安踏/小米/海尔）", () => {
      const [itv] = buildLedgerInterviews(
        [row({ region: "火星", next_due: "2026-08-27" })],
        { now },
      );
      expect(itv.timePrecision).toBe("date");
      expect(itv.sourceTimeZoneConfirmed).toBe(false);
    });
  });

  test("两个字段都过期 → position 带「已逾期」", () => {
    const future = Date.parse("2026-09-01T00:00:00Z");
    const [itv] = buildLedgerInterviews(
      [row({ next_due: "2026-08-14" })],
      { now: future },
    );
    expect(itv.position).toContain("已逾期");
  });

  test("status → type 的近似映射", () => {
    const rows = [
      row({ id: 1, status: "oa", next_due: "2026-08-27" }),
      row({ id: 2, status: "phone", next_due: "2026-08-27" }),
      row({ id: 3, status: "applied", next_due: "2026-08-27" }),
    ];
    const itvs = buildLedgerInterviews(rows, { now });
    expect(itvs.map((i) => i.type)).toEqual(["assessment", "phone", "hr"]);
  });

  test("next_due 与 deadline 都解析不出来的行被跳过，不产出事件", () => {
    const itvs = buildLedgerInterviews(
      [row({ next_due: "2026年8月起网申", deadline: null })],
      { now },
    );
    expect(itvs).toHaveLength(0);
  });

  test("next_action 进 jdNotes，缺省为 null", () => {
    const [withAction] = buildLedgerInterviews(
      [row({ next_due: "2026-08-27", next_action: "等测评结果" })],
      { now },
    );
    expect(withAction.prep.jdNotes).toBe("等测评结果");

    const [withoutAction] = buildLedgerInterviews(
      [row({ next_due: "2026-08-27", next_action: null })],
      { now },
    );
    expect(withoutAction.prep.jdNotes).toBeNull();
  });
});
