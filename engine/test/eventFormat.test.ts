import { describe, expect, it } from "vitest";
import { classifyEventFormat } from "../src/eventFormat.js";

const interview = (text: string) => classifyEventFormat(text, "interview").format;
const assessment = (text: string) => classifyEventFormat(text, "assessment").format;

describe("面试的形式", () => {
  it.each([
    ["请于周三 14:00 参加电话面试", "phone_interview"],
    ["We would like to schedule a phone screen with you", "phone_interview"],
    ["视频面试将通过腾讯会议进行", "video_interview"],
    ["Your video interview is scheduled for 17 October", "video_interview"],
    ["面试方式：飞书视频会议，会议号 123 456", "video_interview"],
    ["请携带身份证参加线下面试，面试地点：上海市浦东新区", "onsite_interview"],
    ["You are invited to an in-person interview at our office", "onsite_interview"],
    ["请在 48 小时内完成 AI 面试", "ai_interview"],
    ["Please complete your on-demand video interview via HireVue", "ai_interview"],
  ])("%s → %s", (text, expected) => {
    expect(interview(text)).toBe(expected);
  });

  it("AI 视频面试是 AI 面试，不因为出现「视频」就判成视频面试", () => {
    expect(interview("请完成 AI 视频面试，系统将录制你的作答")).toBe("ai_interview");
    expect(interview("本轮为录制式视频面试，无面试官在线")).toBe("ai_interview");
  });

  it("没说形式就是 unspecified，不猜", () => {
    const r = classifyEventFormat("Your interview is scheduled for 15 October at 10:00.", "interview");
    expect(r.format).toBe("unspecified");
    expect(r.reason).toContain("没有说明");
  });
});

describe("测评的形式", () => {
  it.each([
    ["现邀请你参加在线笔试", "written_test"],
    ["Please complete the online test within 5 days", "written_test"],
    ["请在 72 小时内完成在线测评", "online_assessment"],
    ["You have been invited to complete an online assessment", "online_assessment"],
  ])("%s → %s", (text, expected) => {
    expect(assessment(text)).toBe(expected);
  });

  it("笔试与测评同时出现时以笔试为准", () => {
    expect(assessment("测评中心通知：请参加在线笔试")).toBe("written_test");
  });

  it("被归为测评类的 AI 面试仍标成 AI 面试", () => {
    expect(assessment("请完成 AI 面试环节")).toBe("ai_interview");
  });

  it("没说形式就是 unspecified", () => {
    expect(assessment("请按时完成本环节")).toBe("unspecified");
  });
});

describe("不适用的事件类型", () => {
  it.each(["application_ok", "result", "update", "reminder", "other"] as const)(
    "%s 不区分形式，即使正文里有面试字样",
    (eventType) => {
      expect(classifyEventFormat("感谢参加视频面试", eventType).format).toBe("not_applicable");
    },
  );

  it("依据里带命中的原文", () => {
    expect(classifyEventFormat("请参加电话面试", "interview").reason).toBe("原文出现「电话面试」");
  });
});
