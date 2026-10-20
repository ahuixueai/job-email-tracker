import { describe, expect, it } from "vitest";
import { runDemoParse } from "@/lib/demo/parseDemo";
import { parseEmail, StubExtractor } from "@/lib/tracker-core/index";
import type { RawEmail } from "@/lib/tracker-core/index";
import { extractorNote, forwardingNotices, noticeGroupIds, toLiveData } from "../src/live";
import type { EmailRow } from "../src/live";

const VIEWER = "Asia/Shanghai";

const RAW: RawEmail = {
  id: "e1",
  from: "星河科技校园招聘 <campus@xinghe.example>",
  to: "",
  subject: "【星河科技】在线笔试通知",
  body: "同学你好，\n考试时间：10月20日 19:00-20:40（北京时间）\n考试码：XHKJ-7Q4M",
  receivedAtUtc: "2026-10-12T03:00:00.000Z",
};

async function row(over: Partial<EmailRow> = {}): Promise<EmailRow> {
  const outcome = await parseEmail(RAW, { extractor: new StubExtractor() });
  return {
    id: RAW.id,
    received_at: RAW.receivedAtUtc,
    stored_at: RAW.receivedAtUtc,
    via: "auto",
    from_addr: RAW.from,
    subject: RAW.subject,
    body: RAW.body,
    status: "parsed",
    outcome: JSON.stringify(outcome),
    model: null,
    error: null,
    ...over,
  };
}

describe("收信记录 → 看板", () => {
  it("用存下的结论，和现场解析同一封信的结果一致", async () => {
    const live = toLiveData([await row()], VIEWER);
    const expected = await runDemoParse(RAW, { viewerTimeZone: VIEWER });
    expect(live.results.get("e1")).toEqual(expected);
    expect(live.samples[0]!.raw.body).toBe(RAW.body);
    expect(live.samples[0]!.teaches).toBe("Gmail 自动转发");
  });

  it("从旧到新排：新来的信不会改变已有事件的 id", async () => {
    const live = toLiveData(
      [await row({ id: "new", received_at: "2026-10-12T05:00:00.000Z" }), await row({ id: "old", received_at: "2026-10-11T05:00:00.000Z" })],
      VIEWER,
    );
    expect(live.samples.map((s) => s.id)).toEqual(["old", "new"]);
  });

  it("你自己发的、处理出错的、结论读不出的：都只在邮件列表里，不进日程", async () => {
    const live = toLiveData(
      [
        await row({ id: "self", status: "self", via: "self", outcome: null }),
        await row({ id: "err", status: "error", outcome: null, error: "模型超时" }),
        await row({ id: "bad", outcome: "{\"kind\":\"parsed\"}" }),
      ],
      VIEWER,
    );
    for (const id of ["self", "err", "bad"]) {
      const result = live.results.get(id)!;
      expect(result.destination).toBe("dropped");
      expect(result.dedupKey).toBeNull();
    }
    expect(live.results.get("self")!.trace[0]!.label).toBe("你发出的信");
    expect(live.results.get("err")!.trace[0]!.reason).toBe("模型超时");
    expect(live.results.get("bad")!.trace[0]!.label).toBe("处理出错");
  });

  it("模型说明：按实际用到的模型写，没用模型就直说", () => {
    const models = new Map<string, string | null>([
      ["a", "deepseek-v4-pro"],
      ["b", null],
    ]);
    expect(extractorNote(models, ["a", "b"])).toContain("deepseek-v4-pro");
    expect(extractorNote(models, ["b"])).toContain("全部由规则判断");
  });

});

describe("邮箱转发确认", () => {
  const NOW = Date.parse("2026-10-16T17:30:00Z");
  it("Gmail 给验证码；QQ 给确认按钮（只认服务商自己的域名，别的链接不做成按钮）；7 天前的不显示", () => {
    const list = forwardingNotices(
      [
        { id: "q", kind: "forward-verify", received_at: "2026-10-16T17:20:00Z", subject: "QQ邮箱自动转发验证邮件", body: "发件人：x\n\n接受转发（https://wx.mail.qq.com/a?x=1&y=2）\n如果你误触导致该转发生效，请点击取消接受转发（https://wx.mail.qq.com/c）\n点我（https://evil.example/x）" },
        { id: "g", kind: "gmail-forwarding", received_at: "2026-10-16T17:00:00Z", subject: "Gmail Forwarding Confirmation", body: "验证码：123456789\n\n..." },
        { id: "old", kind: "forward-verify", received_at: "2026-10-01T00:00:00Z", subject: "旧的", body: "" },
        { id: "n", kind: "other", received_at: "2026-10-16T17:00:00Z", subject: "别的", body: "" },
      ],
      NOW,
    );
    expect(list.map((n) => n.id)).toEqual(["q", "g"]);
    expect(list[0]!.links).toEqual([
      { label: "接受转发", url: "https://wx.mail.qq.com/a?x=1&y=2" },
      { label: "取消接受转发", url: "https://wx.mail.qq.com/c" },
    ]);
    expect(list[1]).toMatchObject({ provider: "gmail", code: "123456789", links: [] });
  });

  it("Gmail 确认信里的裸地址也做成「一键确认」；认不出的给出正文开头", () => {
    const [g, x] = forwardingNotices(
      [
        { id: "g", kind: "gmail-forwarding", received_at: "2026-10-16T17:00:00Z", subject: "Gmail Forwarding Confirmation", body: "验证码：123456789\n\nTo allow a@x to forward, click:\nhttps://mail-settings.google.com/mail/vf-abc.\nhttp://evil.example/x" },
        { id: "x", kind: "forward-verify", received_at: "2026-10-16T17:00:00Z", subject: "Please verify forwarding", body: "发件人：x\n\n你的确认码是 8812" },
      ],
      NOW,
    );
    expect(g!.links).toEqual([{ label: "一键确认转发", url: "https://mail-settings.google.com/mail/vf-abc" }]);
    expect(x!.links).toEqual([]);
    expect(x!.excerpt).toBe("你的确认码是 8812");
  });
});

describe("转发确认什么时候不再显示", () => {
  const NOW = Date.parse("2026-10-16T20:00:00Z");
  const gmail = (id: string, at: string, code: string) => ({ id, kind: "gmail-forwarding", received_at: at, subject: "Gmail Forwarding Confirmation", body: `验证码：${code}\n\nhttps://mail-settings.google.com/mail/vf-${id}\nhttps://support.google.com/mail/x` });
  it("确认一封：同一个邮箱以前的旧确认一起删，别的邮箱的不动", () => {
    const rows = [
      gmail("c", "2026-10-12T18:31:00Z", "333333333"),
      gmail("b", "2026-10-12T18:27:00Z", "222222222"),
      { id: "q", kind: "forward-verify", received_at: "2026-10-16T17:20:00Z", subject: "QQ邮箱自动转发验证邮件", body: "" },
    ];
    expect(noticeGroupIds(rows, "c")).toEqual(["c", "b"]);
    expect(noticeGroupIds(rows, "q")).toEqual(["q"]);
  });

  it("同一个邮箱申请了几次只留最新；只留第一个链接", () => {
    const rows = [gmail("c", "2026-10-12T18:31:00Z", "333333333"), gmail("b", "2026-10-12T18:27:00Z", "222222222"), gmail("a", "2026-10-12T18:25:00Z", "111111111")];
    const pending = forwardingNotices(rows, NOW);
    expect(pending.map((n) => [n.id, n.code])).toEqual([["c", "333333333"]]);
    expect(pending[0]!.links).toEqual([{ label: "一键确认转发", url: "https://mail-settings.google.com/mail/vf-c" }]);
  });
});
