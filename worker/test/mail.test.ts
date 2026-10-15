import { describe, expect, it } from "vitest";
import {
  admit,
  confirmationCode,
  htmlToText,
  parseAllowList,
  pickBody,
  sentAtUtc,
  stripForwardPrefix,
  unwrapManualForward,
} from "../src/mail.js";

const ME = "me@gmail.example";
const allow = [ME];

describe("认人：只收从自己 Gmail 转过来的信", () => {
  it("Gmail 自动转发：原发件人保留，靠 X-Forwarded-For 认出是我转的", () => {
    const v = admit("bounce@hr.example", "HR <hr@company.example>", [{ key: "x-forwarded-for", value: `${ME} jobs@my.example` }], allow);
    expect(v).toEqual({ kind: "job", via: "auto" });
  });

  it("手动转发：发件人就是我", () => {
    expect(admit(ME, `Me <${ME}>`, [], allow)).toEqual({ kind: "job", via: "manual" });
  });

  it("大小写不影响", () => {
    expect(admit("ME@Gmail.Example", "", [], allow)).toEqual({ kind: "job", via: "manual" });
  });

  it("陌生人直接发到收信地址：拒收", () => {
    expect(admit("spam@x.example", "Spam <spam@x.example>", [], allow).kind).toBe("reject");
  });

  it("X-Forwarded-For 里是别人的地址：拒收", () => {
    const v = admit("a@x.example", "A <a@x.example>", [{ key: "X-Forwarded-For", value: "other@gmail.example jobs@my.example" }], allow);
    expect(v.kind).toBe("reject");
  });

  it("Gmail 开启转发时的验证信单独收下", () => {
    expect(admit("forwarding-noreply@google.com", "", [], allow)).toEqual({ kind: "gmail-forwarding-confirmation" });
    expect(admit("x@google.com", "Gmail Team <forwarding-noreply@google.com>", [], []).kind).toBe("gmail-forwarding-confirmation");
  });

  it("没配置允许列表时一律拒收", () => {
    expect(admit(ME, ME, [], []).kind).toBe("reject");
  });

  it("允许列表的写法：逗号或空格分隔，忽略不像地址的", () => {
    expect(parseAllowList(" A@x.example, b@y.example  junk ")).toEqual(["a@x.example", "b@y.example"]);
    expect(parseAllowList(undefined)).toEqual([]);
  });
});

describe("正文", () => {
  it("HTML 转纯文本：样式表和脚本整段去掉，换行保留", () => {
    const html =
      '<html><head><style>p{color:red}</style></head><body><script>x()</script><p>面试时间：10月20日 14:00</p><div>地点<br>线上</div><!-- c --><table><tr><td>A</td><td>B</td></tr></table></body></html>';
    expect(htmlToText(html)).toBe("面试时间：10月20日 14:00\n地点\n线上\nA B");
  });

  it("有正常的纯文本就用纯文本", () => {
    expect(pickBody("正文".repeat(200), "<p>别的</p>")).toBe("正文".repeat(200));
  });

  it("纯文本只是一句占位提示时，改用 HTML", () => {
    const html = `<p>${"笔试通知 ".repeat(100)}</p>`;
    expect(pickBody("请使用支持 HTML 的客户端查看", html)).toContain("笔试通知");
  });

  it("只有 HTML / 什么都没有", () => {
    expect(pickBody(undefined, "<p>只有这个</p>")).toBe("只有这个");
    expect(pickBody(undefined, undefined)).toBe("");
    expect(pickBody("  ", undefined)).toBe("");
  });
});

describe("手动转发：把原信拆出来", () => {
  it("英文界面", () => {
    const body = [
      "看看这个",
      "",
      "---------- Forwarded message ---------",
      "From: 星河科技 <hr@xinghe.example>",
      "Date: Mon, Oct 12, 2026 at 9:00 AM",
      "Subject: 笔试通知",
      "To: <me@gmail.example>",
      "",
      "考试时间：10月20日 19:00（北京时间）",
    ].join("\n");
    expect(unwrapManualForward(body)).toEqual({
      from: "星河科技 <hr@xinghe.example>",
      subject: "笔试通知",
      body: "考试时间：10月20日 19:00（北京时间）",
    });
  });

  it("中文界面", () => {
    const body = "---------- 已转发的邮件 ---------\n发件人： HR <hr@a.example>\n日期： 2026年10月12日周一 09:00\n主题： 面试邀请\n收件人： <me@gmail.example>\n\n面试时间：10月21日 10:00";
    const original = unwrapManualForward(body);
    expect(original?.from).toBe("HR <hr@a.example>");
    expect(original?.subject).toBe("面试邀请");
    expect(original?.body).toBe("面试时间：10月21日 10:00");
  });

  it("不是转发的信返回 null", () => {
    expect(unwrapManualForward("普通正文")).toBeNull();
    expect(unwrapManualForward("---------- Forwarded message ---------\n\n没有头部")).toBeNull();
  });

  it("主题去掉一层或多层转发前缀", () => {
    expect(stripForwardPrefix("Fwd: 笔试通知")).toBe("笔试通知");
    expect(stripForwardPrefix("转发：Fwd: FW: 面试")).toBe("面试");
    expect(stripForwardPrefix("面试")).toBe("面试");
  });
});

describe("时间与验证码", () => {
  const NOW = Date.parse("2026-10-12T04:00:00Z");

  it("原信的 Date 头换算成 UTC", () => {
    expect(sentAtUtc("Mon, 12 Oct 2026 09:00:00 +0800", NOW)).toBe("2026-10-12T01:00:00.000Z");
  });

  it("没有或解析不了时用收信时刻", () => {
    expect(sentAtUtc(undefined, NOW)).toBe("2026-10-12T04:00:00.000Z");
    expect(sentAtUtc("乱写", NOW)).toBe("2026-10-12T04:00:00.000Z");
  });

  it("离谱的日期（一年以上的偏差）不信", () => {
    expect(sentAtUtc("Mon, 12 Oct 1998 09:00:00 +0800", NOW)).toBe("2026-10-12T04:00:00.000Z");
  });

  it("Gmail 转发验证码", () => {
    expect(confirmationCode("Confirmation code: 123456789")).toBe("123456789");
    expect(confirmationCode("确认码：987654321")).toBe("987654321");
    expect(confirmationCode("没有码")).toBeNull();
  });
});
