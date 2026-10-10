import { describe, expect, it } from "vitest";
import { parseEmail } from "../src/pipeline.js";
import type { ParseOutcome } from "../src/pipeline.js";
import { StubExtractor } from "../src/extract.js";
import { classifyEventType } from "../src/eventType.js";
import { findExplicitTimeZone, inferTimeZone } from "../src/timezone.js";

/**
 * 英文招聘邮件的端到端用例。全部是合成邮件（虚构公司、.example 域名）。
 *
 * 收信时刻固定为 2026-10-09 17:00 UTC（周五，纽约 13:00、北京次日 01:00）。
 * 那个时间美国在夏令时：发件人写 EST，实际偏移是 EDT（UTC-4）。
 */
const RECEIVED = "2026-10-09T17:00:00.000Z";

async function parse(from: string, subject: string, body: string): Promise<ParseOutcome> {
  return parseEmail(
    { id: "en", from, to: "u@inbox.example", subject, body, receivedAtUtc: RECEIVED },
    { extractor: new StubExtractor() },
  );
}

function parsed(outcome: ParseOutcome) {
  if (outcome.kind !== "parsed") throw new Error(`被预筛丢弃：${outcome.reason}`);
  return outcome;
}

describe("英文：是什么事", () => {
  it("电话初筛（phone screen）是面试", async () => {
    const o = parsed(
      await parse(
        "Sierra Robotics <talent@sierra-robotics.example>",
        "Phone screen with Sierra Robotics",
        "We'd like to schedule a 30-minute phone screen for the Operations Associate role on Oct 14 at 10:00 AM PT.",
      ),
    );
    expect(o.event.eventType).toBe("interview");
    expect(o.trace.format.format).toBe("phone_interview");
    expect(o.event.dueType).toBe("fixed_start");
    expect(o.event.startUtc).toBe("2026-10-14T17:00:00.000Z");
    expect(o.event.sourceTimeZone).toBe("America/Los_Angeles");
  });

  it("投递回执", async () => {
    const o = parsed(
      await parse(
        "Atlas Consulting <no-reply@atlas-consulting.example>",
        "Thank you for applying to Atlas Consulting",
        "We have received your application for the Associate Consultant position. Our team will review your materials and reach out if there is a match.",
      ),
    );
    expect(o.event.eventType).toBe("application_ok");
    expect(o.event.dueType).toBe("unknown");
  });

  it("拒信以「Thank you for applying」开头也判成结果，不是投递成功", async () => {
    const o = parsed(
      await parse(
        "Atlas Consulting <no-reply@atlas-consulting.example>",
        "Update on your application",
        "Thank you for applying to Atlas Consulting. After careful consideration, we regret to inform you that we will not be moving forward with your application.",
      ),
    );
    expect(o.event.eventType).toBe("result");
  });

  it.each([
    "We have decided to move forward with other candidates.",
    "Unfortunately we are not moving forward with your candidacy at this time.",
    "We are unable to offer you a position at this time.",
    "We are pleased to offer you the position of Strategy Analyst.",
    "Please find attached your offer of employment.",
  ])("明确的决定：%s", (sentence) => {
    expect(
      classifyEventType({ subject: "Your application", body: `Thank you for your application. ${sentence}` })
        .eventType,
    ).toBe("result");
  });

  it("回执里的条件句不算结果：没被选上的话不另行通知", () => {
    const r = classifyEventType({
      subject: "Application received",
      body: "Thank you for applying. If you are not selected for an interview, you may not hear back from us.",
    });
    // 「interview」在正文里，行动项优先——但绝不能是 result
    expect(r.eventType).not.toBe("result");
  });

  it("行动项仍然优先于结果：通过了并且要做测评", () => {
    const r = classifyEventType({
      subject: "Next steps",
      body: "Congratulations, we are pleased to extend an invitation to the online assessment.",
    });
    expect(r.eventType).toBe("assessment");
  });

  it("编程测试不再在预筛被丢掉", async () => {
    const o = parsed(
      await parse(
        "Pioneer Health <jobs@pioneer-health.example>",
        "Coding challenge",
        "Hello,\n\nPlease complete the coding challenge by October 15, 2026 at 5:00 PM ET. Link: https://challenge.pioneer-health.example/c/77",
      ),
    );
    expect(o.event.eventType).toBe("assessment");
    expect(o.trace.format.format).toBe("written_test");
    expect(o.event.dueType).toBe("deadline");
    expect(o.event.startUtc).toBe("2026-10-15T21:00:00.000Z");
    expect(o.trace.action.links).toEqual(["https://challenge.pioneer-health.example/c/77"]);
  });

  it("HireVue 录制面试：AI 面试", async () => {
    const o = parsed(
      await parse(
        "HireVue <noreply@hirevue-mail.example>",
        "Meridian Bank invites you to a HireVue interview",
        "Meridian Bank has invited you to complete an on-demand video interview for the 2027 Analyst Program.",
      ),
    );
    expect(o.event.eventType).toBe("interview");
    expect(o.trace.format.format).toBe("ai_interview");
  });

  it("到办公室面试：线下面试", async () => {
    const o = parsed(
      await parse(
        "Thames Advisory <graduates@thames-advisory.example>",
        "Invitation to interview",
        "We are delighted to invite you to a first round interview on 15 October 2026 at 09:30 BST at our London office.",
      ),
    );
    expect(o.trace.format.format).toBe("onsite_interview");
    expect(o.event.startUtc).toBe("2026-10-15T08:30:00.000Z");
    expect(o.event.sourceTimeZone).toBe("Europe/London");
  });
});

describe("英文：什么时候", () => {
  it("写的是 EST，十月实际是夏令时，按 EDT 换算", async () => {
    const o = parsed(
      await parse(
        "Harbor Capital Recruiting <recruiting@harborcap.example>",
        "Interview Confirmation - Product Analyst",
        "Your interview is confirmed for Tuesday, October 13, 2026 at 2:30 PM EST. This will be a video interview via Zoom.",
      ),
    );
    expect(o.event.dueType).toBe("fixed_start");
    expect(o.event.startUtc).toBe("2026-10-13T18:30:00.000Z");
    expect(o.trace.format.format).toBe("video_interview");
  });

  it("complete by … ET：截止期限", async () => {
    const o = parsed(
      await parse(
        "Northwind Analytics <no-reply@northwind-analytics.example>",
        "Your Online Assessment for Business Analyst",
        "Please complete the online assessment by October 16, 2026 at 11:59 PM ET.",
      ),
    );
    expect(o.event.dueType).toBe("deadline");
    expect(o.event.startUtc).toBe("2026-10-17T03:59:00.000Z");
  });

  it("within 5 days：从收信时刻起算", async () => {
    const o = parsed(
      await parse(
        "Talent Team <careers@lumen-retail.example>",
        "Next steps: Online Assessment",
        "Please complete the assessment within 5 days of receiving this email.",
      ),
    );
    expect(o.event.dueType).toBe("deadline");
    expect(o.event.startUtc).toBe("2026-10-14T17:00:00.000Z");
  });

  it("窗口的开放时刻不是场次：以关闭时刻为截止", async () => {
    const o = parsed(
      await parse(
        "Orchid Bank Careers <careers@orchidbank.example>",
        "Online Test Invitation - Graduate Associate",
        "The test window opens on 12 Oct 2026, 9:00 AM SGT and closes on 14 Oct 2026, 6:00 PM SGT.",
      ),
    );
    expect(o.event.dueType).toBe("deadline");
    expect(o.event.startUtc).toBe("2026-10-14T10:00:00.000Z");
  });

  it("starts at 仍然是真场次，不被「窗口开放」规则误伤", async () => {
    const o = parsed(
      await parse(
        "Orchid Bank Careers <careers@orchidbank.example>",
        "Online Test",
        "The online test starts at 9:00 AM SGT on 12 Oct 2026. Late entry is not permitted.",
      ),
    );
    expect(o.event.dueType).toBe("fixed_start");
    expect(o.event.startUtc).toBe("2026-10-12T01:00:00.000Z");
  });

  it("改期：取新的时间", async () => {
    const o = parsed(
      await parse(
        "Harbor Capital Recruiting <recruiting@harborcap.example>",
        "Interview rescheduled",
        "Your interview has been rescheduled from October 13 to Thursday, October 15, 2026 at 11:00 AM ET.",
      ),
    );
    expect(o.event.startUtc).toBe("2026-10-15T15:00:00.000Z");
    expect(o.trace.eventType.shouldMerge).toBe(true);
  });

  it("只写了日期、没有任何时区线索：不给时刻", async () => {
    const o = parsed(
      await parse(
        "HireVue <noreply@hirevue-mail.example>",
        "Complete your interview",
        "Please complete your on-demand video interview by Sunday, October 18, 2026.",
      ),
    );
    expect(o.event.startUtc).toBeNull();
    expect(o.event.sourceTimeZone).toBeNull();
  });
});

describe("英文：哪个时区", () => {
  it.each([
    ["3 PM Eastern Time", "America/New_York"],
    ["10:00 AM Pacific Time", "America/Los_Angeles"],
    ["2:00 PM Pacific Standard Time", "America/Los_Angeles"],
    ["9 AM Central Time", "America/Chicago"],
    ["9 AM CT", "America/Chicago"],
    ["4 PM Mountain Time", "America/Denver"],
    ["10:00 UK time", "Europe/London"],
    ["2 PM GST", "Asia/Dubai"],
    ["11 AM AEDT", "Australia/Sydney"],
  ])("%s → %s", (text, zone) => {
    expect(findExplicitTimeZone(text)).toBe(zone);
  });

  it("裸的 CST 不认：美国中部时间和中国标准时间差 14 小时", () => {
    expect(findExplicitTimeZone("5:00 PM CST")).toBeNull();
  });

  it.each([
    ["at our Chicago office", "America/Chicago"],
    ["in San Francisco", "America/Los_Angeles"],
    ["our Seattle headquarters", "America/Los_Angeles"],
    ["Boston, MA", "America/New_York"],
    ["Toronto office", "America/Toronto"],
  ])("地点：%s → %s", (text, zone) => {
    const r = inferTimeZone({ text });
    expect(r.tz).toBe(zone);
    expect(r.source).toBe("location");
  });

  it("英文邮件但没有任何线索：仍然不猜", () => {
    expect(inferTimeZone({ text: "Your interview is on October 15 at 10:00 AM." }).tz).toBeNull();
  });
});
