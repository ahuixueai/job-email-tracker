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

  it("QQ 收信规则自动转发：信封发件人是「QQ号+auto_=收信地址@qq.com」，没有 X-Forwarded-For（10/16 实测）", () => {
    const qq = ["10001@qq.com"];
    expect(admit("10001+auto_=u-k3x9q2m7pz=interviewtrack.me@qq.com", "HR <noreply@hr.example>", [{ key: "x-qq-auto-fwd", value: "1" }], qq)).toEqual({ kind: "job", via: "auto" });
    expect(admit("other+auto_=x@qq.com", "HR <noreply@hr.example>", [], qq).kind).toBe("reject");
    expect(admit("10001+x@evil.example", "HR <noreply@hr.example>", [], qq).kind).toBe("reject");
  });

  it("网易来信分类转发：信封发件人「auto_用户名+收信地址@163.com」，或 Resent-From（10/16 实测）", () => {
    const n = ["alice2026@163.com"];
    expect(admit("auto_alice2026+u-b7c2d9e4f1=interviewtrack.me@163.com", "HR <noreply@hr.example>", [], n)).toEqual({ kind: "job", via: "auto" });
    expect(admit("bounce@x.example", "HR <noreply@hr.example>", [{ key: "Resent-From", value: "alice2026@163.com" }], n)).toEqual({ kind: "job", via: "auto" });
    expect(admit("auto_someone+u-x=interviewtrack.me@163.com", "HR <noreply@hr.example>", [], n).kind).toBe("reject");
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

  it("链接留下地址：按钮文字 +（地址）；文字就是地址时不重复；只有图片的链接不留；实体还原", () => {
    const html =
      '<p>哑巴&lt;a@qq.example&gt; 设置了转发</p><a href="https://mail.qq.example/cgi?a=1&amp;b=2" style="x"><span>接受转发</span></a>' +
      '<p><a href="https://exam.example/t">https://exam.example/t</a> <a href="mailto:hr@x.example">写信</a><a href="https://track.example/logo"><img src="x.png"></a></p>';
    expect(htmlToText(html)).toBe("哑巴<a@qq.example> 设置了转发\n接受转发（https://mail.qq.example/cgi?a=1&b=2） https://exam.example/t 写信");
  });

  it("有正常的纯文本就用纯文本", () => {
    expect(pickBody("正文".repeat(200), "<p>别的</p>")).toBe("正文".repeat(200));
  });

  it("纯文本只是一句占位提示时，改用 HTML", () => {
    const html = `<p>${"笔试通知 ".repeat(100)}</p>`;
    expect(pickBody("请使用支持 HTML 的客户端查看", html)).toContain("笔试通知");
  });

  it("纯文本里没有链接、HTML 里有：用 HTML 的（按钮地址不丢）", () => {
    expect(pickBody("接受转发\n取消接受转发" + "。".repeat(300), '<a href="https://mail.qq.example/a">接受转发</a>')).toBe("接受转发（https://mail.qq.example/a）");
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

  it("QQ 邮箱网页版转发（转成文字后只剩「原始邮件」一行；前面是转发人的名片）", () => {
    const body = [
      "小明 me@qq.example（https://wx.mail.qq.com/home/index?t=readmail_businesscard_midpage）",
      "",
      "原始邮件",
      "",
      "发件人： 携程集团(Trip.com Group) <trip-no-reply@mail.mokahr.example>",
      "发件时间： 2026年10月12日 05:23",
      "收件人： me <me@gmail.example>",
      "主题： 【携程校招】今晚19:00，秋招冲刺岗位专场直播来袭！",
      "",
      "",
      "你好，",
      "秋招进度条走到这里",
    ].join("\n");
    expect(unwrapManualForward(body)).toEqual({
      from: "携程集团(Trip.com Group) <trip-no-reply@mail.mokahr.example>",
      subject: "【携程校招】今晚19:00，秋招冲刺岗位专场直播来袭！",
      body: "你好，\n秋招进度条走到这里",
    });
  });

  it("QQ 纯文本转发（分隔行带 &nbsp;，键后面没有空格、值后面带分号）", () => {
    const body = "------------------&nbsp;原始邮件&nbsp;------------------\n发件人：李老师 <noreply@hr.example>;\n发件时间：2026年10月16日(星期五) 下午3:00\n收件人：me <me@gmail.example>;\n主题：管理培训生面试邀请\n\n面试日期: 2026-10-19 14:00";
    expect(unwrapManualForward(body)).toEqual({ from: "李老师 <noreply@hr.example>", subject: "管理培训生面试邀请", body: "面试日期: 2026-10-19 14:00" });
  });

  it("Outlook（只有一条下划线）和没有分隔行、只有「发件人 … 主题」的", () => {
    const outlook = "________________________________\nFrom: HR <hr@b.example>\nSent: Friday, October 16, 2026 3:00 PM\nTo: me@outlook.example\nSubject: Interview invitation\n\nYour interview is on Oct 20.";
    expect(unwrapManualForward(outlook)).toMatchObject({ from: "HR <hr@b.example>", subject: "Interview invitation", body: "Your interview is on Oct 20." });
    const bare = "\n\n发件人：HR <hr@c.example>\n发送时间：2026年10月16日\n主题：笔试通知\n\n笔试时间：10月22日";
    expect(unwrapManualForward(bare)).toMatchObject({ from: "HR <hr@c.example>", subject: "笔试通知", body: "笔试时间：10月22日" });
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
