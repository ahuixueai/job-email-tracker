import { describe, expect, it } from "vitest";
import { runDemoParse } from "@/lib/demo/parseDemo";
import { parseEmail, StubExtractor } from "@/lib/tracker-core/index";
import type { RawEmail } from "@/lib/tracker-core/index";
import { extractorNote, forwardingCode, toLiveData } from "../src/live";
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

  it("Gmail 转发验证码：只提醒 7 天内的", () => {
    const now = Date.parse("2026-10-12T00:00:00Z");
    const notice = { id: "n", kind: "gmail-forwarding", subject: "Gmail Forwarding Confirmation", body: "验证码：123456789\n\n..." };
    expect(forwardingCode([{ ...notice, received_at: "2026-10-11T00:00:00.000Z" }], now)?.code).toBe("123456789");
    expect(forwardingCode([{ ...notice, received_at: "2026-10-01T00:00:00.000Z" }], now)).toBeNull();
    expect(forwardingCode([{ ...notice, body: "没有码", received_at: "2026-10-11T00:00:00.000Z" }], now)).toBeNull();
  });
});
