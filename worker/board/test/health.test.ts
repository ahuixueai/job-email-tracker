import { describe, expect, it } from "vitest";
import { healthWarning, subscribeLinks } from "../src/PrivateSettings";

const NOW = Date.parse("2026-10-13T12:00:00Z");

describe("收信健康提示", () => {
  it("三天没进新邮件才提醒；从没收到过不提醒（刚开始用）", () => {
    expect(healthWarning(null, NOW)).toBeNull();
    expect(healthWarning("2026-10-11T12:00:01Z", NOW)).toBeNull();
    expect(healthWarning("2026-10-10T12:00:00Z", NOW)).toBe("已经 3 天没收到新邮件了，Gmail 转发可能断了。");
  });
});

describe("日历一键订阅的链接", () => {
  it("苹果用 webcal://，Google 用「通过网址添加」并把 webcal 地址编码进去", () => {
    const { webcal, google } = subscribeLinks("https://board.example/cal/abc.ics");
    expect(webcal).toBe("webcal://board.example/cal/abc.ics");
    expect(google).toBe("https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fboard.example%2Fcal%2Fabc.ics");
    expect(subscribeLinks("http://127.0.0.1:8787/cal/x.ics").webcal).toBe("webcal://127.0.0.1:8787/cal/x.ics");
  });
});
