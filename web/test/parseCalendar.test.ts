import { describe, expect, test } from "vitest";
import {
  eventToCandidate,
  parseEvents,
  splitTitle,
  type GoogleEvent,
} from "@/lib/integrations/parseCalendar";

function event(patch: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: "evt-1",
    summary: "面试：数据分析师",
    start: { dateTime: "2026-09-15T06:30:00Z", timeZone: "Asia/Shanghai" },
    end: { dateTime: "2026-09-15T07:30:00Z", timeZone: "Asia/Shanghai" },
    ...patch,
  };
}

describe("筛选：哪些事件算面试", () => {
  test("标题没有任何面试关键词就跳过", () => {
    expect(eventToCandidate(event({ summary: "牙医预约" }), "UTC")).toBeNull();
  });

  test("已取消的事件跳过", () => {
    expect(eventToCandidate(event({ status: "cancelled" }), "UTC")).toBeNull();
  });

  test("整天事件跳过：没有具体时刻", () => {
    const allDay = event({
      start: { date: "2026-09-15" },
      end: { date: "2026-09-16" },
    });
    expect(eventToCandidate(allDay, "UTC")).toBeNull();
  });

  test("关键词在正文里也算，并记下命中了什么", () => {
    const candidate = eventToCandidate(
      event({ summary: "Chat with Stripe", description: "technical screen" }),
      "UTC",
    );
    expect(candidate).not.toBeNull();
    expect(candidate?.matched).toContain("technical");
  });

  test("parseEvents 过滤掉所有不合格的", () => {
    const result = parseEvents(
      [event(), event({ id: "e2", summary: "午饭" }), event({ id: "e3", status: "cancelled" })],
      "UTC",
    );
    expect(result).toHaveLength(1);
  });
});

describe("splitTitle", () => {
  test("「岗位 @ 公司」格式", () => {
    expect(splitTitle("Interview: Data Analyst @ Stripe", null)).toEqual({
      company: "Stripe",
      position: "Data Analyst",
    });
  });

  test("「公司 - 岗位」格式", () => {
    expect(splitTitle("Stripe - 数据分析三面", null)).toEqual({
      company: "Stripe",
      position: "数据分析三面",
    });
  });

  test("拆不出来时用发起人域名当公司", () => {
    expect(splitTitle("三面", "bytedance")).toEqual({
      company: "bytedance",
      position: "三面",
    });
  });

  test("既拆不出也没有域名时，退到标题首词", () => {
    expect(splitTitle("字节跳动 三面", null).company).toBe("字节跳动");
  });
});

describe("类型判定", () => {
  test.each([
    ["笔试 - 字节跳动", "assessment"],
    ["电话面试 - Stripe", "phone"],
    ["HR 初面 - Airbnb", "hr"],
    ["面试 - Monzo", "video"],
  ])("%s → %s", (summary, expected) => {
    expect(eventToCandidate(event({ summary }), "UTC")?.type).toBe(expected);
  });
});

describe("时区", () => {
  test("用事件自带的 IANA 时区", () => {
    const candidate = eventToCandidate(event(), "UTC");
    expect(candidate?.sourceTimeZone).toBe("Asia/Shanghai");
  });

  test("事件没带时区时用调用方给的兜底值", () => {
    const noZone = event({ start: { dateTime: "2026-09-15T06:30:00Z" } });
    expect(eventToCandidate(noZone, "America/New_York")?.sourceTimeZone).toBe(
      "America/New_York",
    );
  });

  /**
   * fallbackTimeZone 来自 /api/integrations/google/import 的 ?tz= 查询参数，
   * 是彻头彻尾的外部输入。不是合法 IANA 名却写进 Interview 的话，
   * 后面每次用 Intl.DateTimeFormat 渲染这张卡都会抛 RangeError。
   */
  test("兜底时区不是合法 IANA 名时退到 UTC，不把脏值写进数据", () => {
    const noZone = event({ start: { dateTime: "2026-09-15T06:30:00Z" } });
    expect(eventToCandidate(noZone, "Asia/火星")?.sourceTimeZone).toBe("UTC");
    expect(eventToCandidate(noZone, "'; DROP TABLE--")?.sourceTimeZone).toBe("UTC");
  });

  test("事件自带的时区是脏值时同样退到兜底值", () => {
    const badZone = event({
      start: { dateTime: "2026-09-15T06:30:00Z", timeZone: "Not/AZone" },
    });
    expect(eventToCandidate(badZone, "Asia/Tokyo")?.sourceTimeZone).toBe("Asia/Tokyo");
  });
});

describe("会议链接", () => {
  test("优先用 hangoutLink", () => {
    const candidate = eventToCandidate(
      event({ hangoutLink: "https://meet.google.com/abc-defg-hij" }),
      "UTC",
    );
    expect(candidate?.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  test("其次用 conferenceData 里的视频入口", () => {
    const candidate = eventToCandidate(
      event({
        conferenceData: {
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+8610000" },
            { entryPointType: "video", uri: "https://zoom.us/j/123" },
          ],
        },
      }),
      "UTC",
    );
    expect(candidate?.meetingUrl).toBe("https://zoom.us/j/123");
  });

  test("最后从正文里正则捞", () => {
    const candidate = eventToCandidate(
      event({ description: "腾讯会议 https://meeting.tencent.com/dm/xyz 见" }),
      "UTC",
    );
    expect(candidate?.meetingUrl).toBe("https://meeting.tencent.com/dm/xyz");
  });

  /**
   * 日历事件是别人能写进你账号的东西——任何人给你发一封邀请，
   * conferenceData 就由对方控制。伪协议不能直接进 href。
   */
  test("伪协议的会议入口不采用", () => {
    const candidate = eventToCandidate(
      event({
        conferenceData: {
          entryPoints: [{ entryPointType: "video", uri: "javascript:alert(1)" }],
        },
      }),
      "UTC",
    );
    expect(candidate?.meetingUrl).toBeNull();
  });

  test("伪协议的 hangoutLink 不采用", () => {
    const candidate = eventToCandidate(
      event({ hangoutLink: "javascript:alert(1)" }),
      "UTC",
    );
    expect(candidate?.meetingUrl).toBeNull();
  });

  test("什么都没有就是 null", () => {
    expect(eventToCandidate(event(), "UTC")?.meetingUrl).toBeNull();
  });
});
