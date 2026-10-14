import { describe, expect, it } from "vitest";
import { clockFromText, dateFromText, EMPTY_QUICK_MODEL, kindFromText, parseQuickModelOutput, resolveQuick } from "@/lib/demo/quickAdd";

// 2026-10-14 周三：纽约上午 10:00，北京晚上 22:00——两地都是周三
const NOW = Date.parse("2026-10-14T14:00:00Z");
const NY = "America/New_York";
const company = (name: string) => ({ ...EMPTY_QUICK_MODEL, company: name });

describe("一句话添加：模型只认名字，名字必须是原话里的字", () => {
  it("编出来的公司、岗位、类型一律不要", () => {
    expect(parseQuickModelOutput({ company: "星河科技集团", role: "产品经理", kindHint: "瞎写" }, "周四星河二面")).toEqual(EMPTY_QUICK_MODEL);
    expect(parseQuickModelOutput({ company: "星河", role: null, kindHint: "video_interview" }, "周四星河二面")).toEqual({
      company: "星河",
      role: null,
      kindHint: "video_interview",
    });
    expect(parseQuickModelOutput("不是对象", "x")).toEqual(EMPTY_QUICK_MODEL);
    // 大小写、全半角不同也算原话
    expect(parseQuickModelOutput({ company: "northwind capital" }, "Thursday 3pm Northwind Capital interview").company).toBe("northwind capital");
  });
});

describe("一句话添加：规则算时间", () => {
  it("周四下午 3 点 + 北京时间：按北京时间算，并写出你这里是几点", () => {
    const r = resolveQuick("周四下午3点星河二面，飞书，北京时间", company("星河"), NOW, NY);
    expect(r).toMatchObject({ company: "星河", kind: "video_interview", timeKind: "fixed_start", local: "2026-10-15T15:00", timeZone: "Asia/Shanghai" });
    expect(r.summary).toBe("10月15日 周四 15:00 北京时间（= 你那里 10月15日 周四 03:00）");
    expect(r.notes).toEqual([]);
  });

  it("没说时区：按你所在的时区，并写明", () => {
    const r = resolveQuick("明天10:30 云帆 电话面", company("云帆"), NOW, NY);
    expect(r).toMatchObject({ kind: "phone_interview", local: "2026-10-15T10:30", timeZone: NY });
    expect(r.notes).toEqual(["没说时区，按你所在的纽约时间填"]);
  });

  it("「3 点」没说上午下午：不猜，钟点空着", () => {
    const r = resolveQuick("下周一 3点 明川笔试 北京时间", company("明川"), NOW, NY);
    expect(r).toMatchObject({ kind: "written_test", local: "", timeZone: "Asia/Shanghai", summary: null });
    expect(r.notes.join("；")).toContain("没说上午还是下午");
  });

  it("「X 日前完成」：截止，没写钟点按 23:59", () => {
    const r = resolveQuick("10月20日前完成北辰测评", company("北辰"), NOW, NY);
    expect(r).toMatchObject({ kind: "online_assessment", timeKind: "deadline", local: "2026-10-20T23:59" });
    expect(r.summary?.startsWith("截止：")).toBe(true);
  });

  it("CST 有歧义：不选，按你所在时区并提醒核对", () => {
    const r = resolveQuick("远山终面 10/18 14:00 CST", company("远山"), NOW, NY);
    expect(r).toMatchObject({ kind: "interview", local: "2026-10-18T14:00", timeZone: NY });
    expect(r.notes.join("；")).toContain("CST");
  });

  it("没写时间：没有具体时间", () => {
    const r = resolveQuick("启明 HR面", company("启明"), NOW, NY);
    expect(r).toMatchObject({ timeKind: "none", local: "", kind: "interview" });
  });

  it("英文也认：Thursday 3pm ET", () => {
    const r = resolveQuick("Thursday 3pm Northwind Capital video interview ET", company("Northwind Capital"), NOW, NY);
    expect(r).toMatchObject({ kind: "video_interview", local: "2026-10-15T15:00", timeZone: NY, notes: [] });
  });

  it("没认出公司：提醒填", () => {
    expect(resolveQuick("明天下午2点面试", EMPTY_QUICK_MODEL, NOW, NY).notes).toContain("没认出公司名，请在下面填");
  });
});

describe("日期规则", () => {
  const today = "2026-10-14"; // 周三
  it("相对说法", () => {
    expect(dateFromText("今天", today)?.date).toBe("2026-10-14");
    expect(dateFromText("后天", today)?.date).toBe("2026-10-16");
    expect(dateFromText("大后天", today)?.date).toBe("2026-10-17");
    expect(dateFromText("周五", today)?.date).toBe("2026-10-16");
    expect(dateFromText("周一", today)?.date).toBe("2026-10-19");
    expect(dateFromText("下周三", today)?.date).toBe("2026-10-21");
    expect(dateFromText("下下周一", today)?.date).toBe("2026-10-26");
    expect(dateFromText("这周一", today)).toEqual({ date: "2026-10-12", note: "这周的周一已经过了，请核对日期" });
    expect(dateFromText("星期三", today)?.note).toContain("今天就是周三");
    expect(dateFromText("next monday", today)?.date).toBe("2026-10-19");
  });

  it("具体日期；没写年份取今年，早于一个月前的算明年", () => {
    expect(dateFromText("十月二十日", today)?.date).toBe("2026-10-20");
    expect(dateFromText("1月5日", today)?.date).toBe("2027-01-05");
    expect(dateFromText("2026年11月3号", today)?.date).toBe("2026-11-03");
    expect(dateFromText("Oct 16", today)?.date).toBe("2026-10-16");
    expect(dateFromText("2月30日", today)).toEqual({ date: null, note: "「2月30日」不是一个有效日期" });
    expect(dateFromText("面试", today)).toBeNull();
  });
});

describe("钟点规则", () => {
  it("上午 / 下午 / 晚上 / 半 / 冒号 / am pm", () => {
    expect(clockFromText("上午十点")?.clock).toBe("10:00");
    expect(clockFromText("下午三点半")?.clock).toBe("15:30");
    expect(clockFromText("晚上8点15分")?.clock).toBe("20:15");
    expect(clockFromText("中午12点")?.clock).toBe("12:00");
    expect(clockFromText("15:00")?.clock).toBe("15:00");
    expect(clockFromText("下午3:30")?.clock).toBe("15:30");
    expect(clockFromText("10 am")?.clock).toBe("10:00");
    expect(clockFromText("3:30pm")?.clock).toBe("15:30");
    expect(clockFromText("14点")?.clock).toBe("14:00");
    expect(clockFromText("24:00前")).toEqual({ clock: "23:59", note: "「24 点」按当天 23:59 填" });
    expect(clockFromText("3点")?.clock).toBeNull();
    expect(clockFromText("面试")).toBeNull();
  });
});

describe("类型规则", () => {
  it("按原话里的字", () => {
    expect(kindFromText("AI面")).toBe("ai_interview");
    expect(kindFromText("腾讯会议一面")).toBe("video_interview");
    expect(kindFromText("线下终面")).toBe("onsite_interview");
    expect(kindFromText("线上笔试")).toBe("written_test");
    expect(kindFromText("OA")).toBe("online_assessment");
    expect(kindFromText("补材料")).toBe("update");
    expect(kindFromText("交流一下")).toBeNull();
  });
});
