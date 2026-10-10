import { describe, expect, test } from "vitest";
import {
  emptyForm,
  formFromInterview,
  interviewFromForm,
  timeZoneOptions,
  validateForm,
  type InterviewFormValues,
} from "@/lib/interviewForm";
import { getLocalTimeZone, normalizeTimeZone } from "@/lib/time";
import { makeInterview } from "./helpers";

function values(patch: Partial<InterviewFormValues> = {}): InterviewFormValues {
  return {
    ...emptyForm("cal-1"),
    company: "字节跳动",
    position: "战略分析师",
    date: "2026-09-15",
    time: "14:30",
    durationMinutes: "60",
    sourceTimeZone: "Asia/Shanghai",
    ...patch,
  };
}

describe("validateForm", () => {
  test("填齐了就没有错误", () => {
    expect(validateForm(values())).toEqual({});
  });

  test("公司与岗位为空要报错", () => {
    const errors = validateForm(values({ company: "  ", position: "" }));
    expect(errors.company).toBeTruthy();
    expect(errors.position).toBeTruthy();
  });

  test("日期时间格式不对要报错", () => {
    expect(validateForm(values({ date: "2026/09/15" })).date).toBeTruthy();
    expect(validateForm(values({ time: "下午两点" })).time).toBeTruthy();
  });

  test("时长越界要报错", () => {
    expect(validateForm(values({ durationMinutes: "0" })).durationMinutes).toBeTruthy();
    expect(validateForm(values({ durationMinutes: "601" })).durationMinutes).toBeTruthy();
    expect(validateForm(values({ durationMinutes: "abc" })).durationMinutes).toBeTruthy();
  });

  test("会议链接不是 http/https 要当场报错，而不是静默丢掉", () => {
    const errors = validateForm(values({ meetingUrl: "javascript:alert(1)" }));
    expect(errors.meetingUrl).toBeTruthy();
  });

  test("简历链接同样校验", () => {
    expect(validateForm(values({ resumeUrl: "meet.google.com/x" })).resumeUrl).toBeTruthy();
  });

  test("链接留空是允许的", () => {
    expect(validateForm(values({ meetingUrl: "", resumeUrl: "  " }))).toEqual({});
  });

  test("正常链接不报错", () => {
    expect(
      validateForm(values({ meetingUrl: "https://meet.google.com/abc-defg-hij" })),
    ).toEqual({});
  });
});

describe("interviewFromForm", () => {
  test("用面试当地的墙上时间换算成 UTC", () => {
    // 上海 UTC+8 无夏令时：14:30 → 06:30Z
    const draft = interviewFromForm(values());
    expect(draft.startUtc).toBe("2026-09-15T06:30:00.000Z");
    expect(draft.endUtc).toBe("2026-09-15T07:30:00.000Z");
  });

  test("夏令时交给 Intl，不手写偏移", () => {
    // 纽约 2026-09-15 处于 EDT（UTC-4）：09:00 → 13:00Z
    const draft = interviewFromForm(
      values({ sourceTimeZone: "America/New_York", time: "09:00" }),
    );
    expect(draft.startUtc).toBe("2026-09-15T13:00:00.000Z");
  });

  test("冬令时同一时区偏移不同", () => {
    // 纽约 2026-01-15 是 EST（UTC-5）：09:00 → 14:00Z
    const draft = interviewFromForm(
      values({ sourceTimeZone: "America/New_York", date: "2026-01-15", time: "09:00" }),
    );
    expect(draft.startUtc).toBe("2026-01-15T14:00:00.000Z");
  });

  test("公司与岗位两头的空白被修掉", () => {
    const draft = interviewFromForm(values({ company: "  字节跳动  " }));
    expect(draft.company).toBe("字节跳动");
  });

  test("危险链接不会进 Interview，哪怕绕过了表单校验", () => {
    const draft = interviewFromForm(values({ meetingUrl: "javascript:alert(1)" }));
    expect(draft.prep.meetingUrl).toBeNull();
  });

  test("新建的一律是已排期、手动来源", () => {
    const draft = interviewFromForm(values());
    expect(draft.status).toBe("scheduled");
    expect(draft.source).toBe("manual");
    expect(draft.externalId).toBeNull();
  });
});

describe("formFromInterview", () => {
  const interview = makeInterview({
    id: "itv-1",
    company: "字节跳动",
    position: "战略分析师",
    startUtc: "2026-09-15T06:30:00.000Z",
    endUtc: "2026-09-15T07:45:00.000Z",
    sourceTimeZone: "Asia/Shanghai",
    importance: 4,
    type: "assessment",
    location: "深圳",
    prep: {
      meetingUrl: "https://meeting.tencent.com/x",
      resumeUrl: null,
      jdNotes: "考 SQL",
      checklist: ["带简历"],
    },
  });

  test("UTC 还原成面试当地的墙上时间", () => {
    const form = formFromInterview(interview);
    expect(form.date).toBe("2026-09-15");
    expect(form.time).toBe("14:30");
    expect(form.sourceTimeZone).toBe("Asia/Shanghai");
  });

  test("时长按起止时间算出来", () => {
    expect(formFromInterview(interview).durationMinutes).toBe("75");
  });

  test("null 字段还原成空串，不是字符串 \"null\"", () => {
    const form = formFromInterview(interview);
    expect(form.resumeUrl).toBe("");
    expect(form.meetingUrl).toBe("https://meeting.tencent.com/x");
    expect(form.location).toBe("深圳");
  });

  /** 编辑弹窗打开再原样保存，不该把时间挪走。 */
  test("还原再提交，时间与关键字段不变", () => {
    const round = interviewFromForm(formFromInterview(interview));
    expect(round.startUtc).toBe(interview.startUtc);
    expect(round.endUtc).toBe(interview.endUtc);
    expect(round.company).toBe(interview.company);
    expect(round.importance).toBe(interview.importance);
    expect(round.type).toBe(interview.type);
  });

  test("跨时区的面试还原时用它自己的时区，不是本机时区", () => {
    const 纽约 = makeInterview({
      id: "x",
      startUtc: "2026-07-15T13:00:00.000Z",
      endUtc: "2026-07-15T14:00:00.000Z",
      sourceTimeZone: "America/New_York",
    });
    const form = formFromInterview(纽约);
    // EDT（-4）：13:00Z → 09:00 当地
    expect(form.time).toBe("09:00");
    expect(form.date).toBe("2026-07-15");
  });
});

describe("timeZoneOptions", () => {
  test("本机时区顶在最前面", () => {
    const options = timeZoneOptions();
    expect(options[0]).toBe(getLocalTimeZone());
  });

  test("不重复出现本机时区", () => {
    const options = timeZoneOptions();
    expect(options.filter((z) => z === getLocalTimeZone())).toHaveLength(1);
  });

  test("给出的每一项都是合法 IANA 名", () => {
    for (const zone of timeZoneOptions().slice(0, 50)) {
      expect(normalizeTimeZone(zone)).toBe(zone);
    }
  });
});
