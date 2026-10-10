import { describe, expect, it } from "vitest";
import { prefilter } from "../src/prefilter.js";
import { toCleanEmail } from "../src/rawEmail.js";

function clean(subject: string, body: string, from = "hr@example.com") {
  return toCleanEmail({
    id: "m1",
    from,
    to: "u_x@inbox.example.com",
    subject,
    body,
    receivedAtUtc: "2026-08-11T13:34:00.000Z",
  });
}

describe("prefilter 放行", () => {
  it("命中求职信号词就放行", () => {
    const r = prefilter(clean("小米集团测评邀请", "请在 72 小时内完成在线测评"));
    expect(r.verdict).toBe("pass");
    expect(r.hits).toContain("流程环节");
  });

  it("英文招聘邮件同样放行", () => {
    expect(prefilter(clean("Your application", "We received your resume")).verdict).toBe("pass");
  });

  it("正文没有信号词但发件域名是已知 ATS，照样放行", () => {
    const r = prefilter(clean("通知", "详情请见链接", "no-reply@mail.mokahr.com"));
    expect(r.verdict).toBe("pass");
    expect(r.hits).toContain("ats域名");
  });

  it("只沾一个边也放行——宁可多花一次调用", () => {
    expect(prefilter(clean("关于岗位的说明", "见附件")).verdict).toBe("pass");
  });
});

describe("prefilter 丢弃", () => {
  it("空邮件", () => {
    expect(prefilter(clean("", "")).verdict).toBe("drop");
  });

  it("验证码类噪音", () => {
    const r = prefilter(clean("您的验证码", "验证码 123456，5 分钟内有效"));
    expect(r.verdict).toBe("drop");
    expect(r.reason).toContain("验证码");
  });

  it("英文 verification code 同样丢弃", () => {
    expect(prefilter(clean("Verify your email", "Your verification code is 8891")).verdict).toBe("drop");
  });

  it("既无信号词也非 ATS 域名", () => {
    const r = prefilter(clean("本周订单已发货", "您购买的商品已出库", "notice@shop.example.net"));
    expect(r.verdict).toBe("drop");
  });

  it("丢弃时必须说清理由，便于用户申诉", () => {
    expect(prefilter(clean("周报", "本周进展", "a@b.net")).reason.length).toBeGreaterThan(0);
  });
});
