import { describe, expect, it } from "vitest";
import { InboxStore, route } from "../src/inbox.js";
import type { ParseOutcome } from "../src/pipeline.js";
import type { ParsedEvent } from "../src/types.js";

function event(over: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    company: "京东",
    companyMatched: true,
    eventType: "assessment",
    dueType: "fixed_start",
    startUtc: "2026-08-15T02:00:00.000Z",
    endUtc: null,
    sourceTimeZone: "Asia/Shanghai",
    confidence: "high",
    receivedAtUtc: "2026-08-11T13:34:00.000Z",
    sourceRef: "mail-1",
    ...over,
  };
}

let hashCounter = 0;
function outcome(over: Partial<ParsedEvent> = {}, rawHash?: string): ParseOutcome {
  hashCounter += 1;
  const ev = event(over);
  return {
    kind: "parsed",
    emailId: ev.sourceRef ?? "mail",
    rawHash: rawHash ?? `hash-${hashCounter}`,
    event: ev,
    application: { company: ev.company, companyMatched: ev.companyMatched, role: null, region: null },
    trace: {
      prefilter: { verdict: "pass", reason: "命中求职信号", hits: ["流程环节"] },
      extraction: {
        companyRaw: null, roleRaw: null, locationRaw: null,
        timeText: null, eventTypeHint: null, notJobRelated: false,
      },
      eventType: {
        eventType: ev.eventType, actionable: true, shouldMerge: false,
        confidence: "high", reason: "正文命中信号词", mergeAs: null,
      },
      format: { format: "unspecified", reason: "测试夹具" },
      action: { links: [], credentials: [] },
      tz: { tz: "Asia/Shanghai", confidence: "high", source: "explicit", reason: "写明北京时间" },
      due: {
        dueType: ev.dueType, startUtc: ev.startUtc, endUtc: ev.endUtc,
        confidence: "high", reason: "明确场次", explicitTimeZone: "Asia/Shanghai",
      },
      confidenceReasons: [],
      usedEventTypeHint: false,
    },
  };
}

describe("route 路由规则", () => {
  it("high 与 medium 进主看板", () => {
    expect(route("high", "assessment", []).destination).toBe("board");
    expect(route("medium", "interview", []).destination).toBe("board");
  });

  it("low 但认得出是什么事 → 待确认收件箱", () => {
    expect(route("low", "interview", []).destination).toBe("pending");
  });

  it("low 且连事件类型都认不出 → 噪音区（折叠而非删除）", () => {
    const r = route("low", "other", []);
    expect(r.destination).toBe("noise");
    expect(r.reasons.join("")).toContain("未识别出事件类型");
  });

  it("路由理由原样透传，供 UI 显示「为什么待确认」", () => {
    expect(route("low", "assessment", ["时区未知"]).reasons).toContain("时区未知");
  });
});

describe("InboxStore 入库与去重", () => {
  it("首封信建档", () => {
    const store = new InboxStore();
    const r = store.ingest(outcome());
    expect(r.kind).toBe("created");
    expect(store.size()).toBe(1);
    if (r.kind === "created") expect(r.record.event.remindCount).toBe(1);
  });

  it("同一封信重复转发不递增催办次数", () => {
    const store = new InboxStore();
    store.ingest(outcome({}, "same-hash"));
    const again = store.ingest(outcome({ sourceRef: "mail-2" }, "same-hash"));
    expect(again.kind).toBe("duplicate");
    expect(store.list()[0]?.event.remindCount).toBe(1);
  });

  it("不同的信说同一件事 → 合并且催办次数加一", () => {
    const store = new InboxStore();
    store.ingest(outcome());
    const merged = store.ingest(
      outcome({ sourceRef: "mail-2", receivedAtUtc: "2026-08-13T02:00:00.000Z" }),
    );
    expect(merged.kind).toBe("merged");
    expect(store.size()).toBe(1);
    if (merged.kind === "merged") {
      expect(merged.record.event.remindCount).toBe(2);
      expect(merged.record.event.sourceRefs).toEqual(["mail-1", "mail-2"]);
    }
  });

  it("被丢弃的邮件不产生记录", () => {
    const store = new InboxStore();
    const r = store.ingest({ kind: "dropped", emailId: "m", rawHash: "h", reason: "验证码" });
    expect(r.kind).toBe("dropped");
    expect(store.size()).toBe(0);
  });

  it("后到的高置信邮件把待确认记录提升进主看板", () => {
    const store = new InboxStore();
    store.ingest(outcome({ confidence: "low" }));
    expect(store.counts().pending).toBe(1);
    const merged = store.ingest(outcome({ sourceRef: "mail-2", confidence: "high" }));
    if (merged.kind === "merged") expect(merged.record.destination).toBe("board");
    expect(store.counts()).toEqual({ board: 1, pending: 0, noise: 0 });
  });
});

describe("用户确认与纠错", () => {
  it("确认后进主看板、置信度升到 high、标记为回流样本", () => {
    const store = new InboxStore();
    const created = store.ingest(outcome({ confidence: "low" }));
    const key = created.kind === "created" ? created.dedupKey : "";
    const record = store.confirm(key);
    expect(record?.destination).toBe("board");
    expect(record?.event.confidence).toBe("high");
    expect(record?.correctedByUser).toBe(true);
  });

  it("确认不存在的记录返回 null，不抛异常", () => {
    expect(new InboxStore().confirm("不存在的键")).toBeNull();
  });

  it("用户判定无关 → 折进噪音区但不删除", () => {
    const store = new InboxStore();
    const created = store.ingest(outcome({ confidence: "low", eventType: "interview" }));
    const key = created.kind === "created" ? created.dedupKey : "";
    expect(store.dismiss(key)?.destination).toBe("noise");
    expect(store.size()).toBe(1);
  });
});

describe("用户的修正不被后续邮件推翻", () => {
  it("改过的时间不会被后到的低置信邮件覆盖", () => {
    const store = new InboxStore();
    const created = store.ingest(outcome({ dueType: "date_only", confidence: "low" }));
    const key = created.kind === "created" ? created.dedupKey : "";
    const fixed = store.confirm(key, { startUtc: "2026-08-15T06:00:00.000Z" });
    expect(fixed?.event.startUtc).toBe("2026-08-15T06:00:00.000Z");

    store.ingest(outcome({ sourceRef: "mail-9", startUtc: "2026-08-15T02:00:00.000Z" }));
    const after = store.list().find((r) => r.correctedByUser);
    expect(after?.event.startUtc).toBe("2026-08-15T06:00:00.000Z");
    expect(after?.event.remindCount).toBe(2);
  });

  it("改公司名后 dedupKey 跟着变，仍能取到记录", () => {
    const store = new InboxStore();
    const created = store.ingest(outcome({ company: "京东集团", companyMatched: false }));
    const key = created.kind === "created" ? created.dedupKey : "";
    const fixed = store.confirm(key, { company: "京东" });
    expect(fixed?.event.company).toBe("京东");
    expect(fixed?.event.dedupKey).not.toBe(key);
    expect(store.get(fixed?.event.dedupKey ?? "")).not.toBeNull();
    expect(store.get(key)).toBeNull();
    expect(store.size()).toBe(1);
  });

  it("改完撞上已有记录时并成一条，次数相加", () => {
    const store = new InboxStore();
    store.ingest(outcome({ company: "京东", sourceRef: "mail-a" }));
    const created = store.ingest(outcome({ company: "京东物流集团", companyMatched: false, sourceRef: "mail-b" }));
    const key = created.kind === "created" ? created.dedupKey : "";
    expect(store.size()).toBe(2);

    const fixed = store.confirm(key, { company: "京东" });
    expect(store.size()).toBe(1);
    expect(fixed?.event.remindCount).toBe(2);
    expect(fixed?.event.sourceRefs).toContain("mail-a");
    expect(fixed?.event.sourceRefs).toContain("mail-b");
  });

  it("把时间清空时 dueType 同步退回 unknown，不留下矛盾状态", () => {
    const store = new InboxStore();
    const created = store.ingest(outcome());
    const key = created.kind === "created" ? created.dedupKey : "";
    const fixed = store.confirm(key, { startUtc: null });
    expect(fixed?.event.startUtc).toBeNull();
    expect(fixed?.event.dueType).toBe("unknown");
  });

  it("补上时间时 dueType 从 unknown 升到 date_only", () => {
    const store = new InboxStore();
    const created = store.ingest(outcome({ dueType: "unknown", startUtc: null }));
    const key = created.kind === "created" ? created.dedupKey : "";
    const fixed = store.confirm(key, { startUtc: "2026-08-15T02:00:00.000Z" });
    expect(fixed?.event.dueType).toBe("date_only");
  });

  it("多次修正叠加，先前改过的字段不丢", () => {
    const store = new InboxStore();
    const created = store.ingest(outcome({ companyMatched: false, company: "京东物流集团" }));
    const key = created.kind === "created" ? created.dedupKey : "";
    const once = store.confirm(key, { company: "京东" });
    const twice = store.confirm(once?.event.dedupKey ?? "", { eventType: "interview" });
    expect(twice?.event.company).toBe("京东");
    expect(twice?.event.eventType).toBe("interview");
  });
});

describe("角标与列表", () => {
  it("counts 分桶统计", () => {
    const store = new InboxStore();
    store.ingest(outcome());
    store.ingest(outcome({ sourceRef: "m2", eventType: "interview", confidence: "low", startUtc: "2026-08-20T06:00:00.000Z" }));
    store.ingest(outcome({ sourceRef: "m3", eventType: "other", confidence: "low", dueType: "unknown", startUtc: null }));
    expect(store.counts()).toEqual({ board: 1, pending: 1, noise: 1 });
    expect(store.list("pending")).toHaveLength(1);
    expect(store.list()).toHaveLength(3);
  });
});

describe("认不出公司的记录", () => {
  it("永不与其他记录合并，哪怕类型和日期都一样", () => {
    const store = new InboxStore();
    store.ingest(outcome({ company: "", companyMatched: false, sourceRef: "m1" }));
    store.ingest(outcome({ company: "", companyMatched: false, sourceRef: "m2" }));
    expect(store.size()).toBe(2);
  });

  it("用户确认后仍然保持独立，不会因为公司名还是空就撞在一起", () => {
    const store = new InboxStore();
    const a = store.ingest(outcome({ company: "", companyMatched: false, sourceRef: "m1" }));
    store.ingest(outcome({ company: "", companyMatched: false, sourceRef: "m2" }));
    const key = a.kind === "created" ? a.dedupKey : "";
    const fixed = store.confirm(key);
    expect(fixed?.event.dedupKey).toContain("no-company:");
    expect(store.size()).toBe(2);
  });

  it("用户补上公司名后，键换成正常形态", () => {
    const store = new InboxStore();
    const a = store.ingest(outcome({ company: "", companyMatched: false, sourceRef: "m1" }));
    const key = a.kind === "created" ? a.dedupKey : "";
    const fixed = store.confirm(key, { company: "京东" });
    expect(fixed?.event.dedupKey).toBe("京东|assessment|2026-08-15");
  });
});
