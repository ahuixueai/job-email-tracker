import { describe, expect, test } from "vitest";
import { computeFunnel, type LedgerRow } from "@/lib/funnel";

function r(p: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 1, status: "found", applied_at: null, oa_at: null,
    interview_at: null, closed_at: null, outcome: null,
    first_response_at: null, ...p,
  };
}

describe("线索池：隔在漏斗外", () => {
  test("待投与已归档分开计，合计为线索总数", () => {
    const f = computeFunnel([
      r({ id: 1, status: "found" }),
      r({ id: 2, status: "found" }),
      r({ id: 3, status: "closed", outcome: "n_a" }),
    ]);
    expect(f.leads).toEqual({ total: 3, pending: 2, archived: 1 });
  });

  test("线索不是漏斗的一级", () => {
    const f = computeFunnel([r({ status: "found" })]);
    expect(f.stages.map((s) => s.key)).toEqual(["applied", "oa", "interview", "offer"]);
  });
});

describe("漏斗每级 = 有对应时间戳的条数，不是当前 status", () => {
  test("已进到面试的记录，仍然计入测评那一级（累计，不因状态前进而丢）", () => {
    const f = computeFunnel([
      r({ id: 1, status: "phone", applied_at: "2026-08-01",
          oa_at: "2026-08-05", interview_at: "2026-08-09" }),
    ]);
    expect(f.stages.find((s) => s.key === "oa")!.count).toBe(1);
    expect(f.stages.find((s) => s.key === "interview")!.count).toBe(1);
  });

  test("status=oa 但没有 oa_at 的不计入测评级", () => {
    const f = computeFunnel([r({ id: 1, status: "oa", applied_at: "2026-08-01" })]);
    expect(f.stages.find((s) => s.key === "oa")!.count).toBe(0);
  });

  test("offer 级看 outcome 不看时间戳", () => {
    const f = computeFunnel([
      r({ id: 1, status: "offer", outcome: "offer", applied_at: "2026-08-01" }),
    ]);
    expect(f.stages.find((s) => s.key === "offer")!.count).toBe(1);
  });
});

describe("投递级：applied_at 残缺，必须两条路都认且把缺口说出来", () => {
  /**
   * applied_at 只有 8/50 有值，但 status 已经进到 oa/phone 的记录
   * 一定投递过——没投过不可能收到测评邀请。只按 applied_at 数会漏掉 7 条。
   */
  test("有 applied_at 的算投递", () => {
    const f = computeFunnel([r({ id: 1, status: "applied", applied_at: "2026-08-01" })]);
    expect(f.stages[0].count).toBe(1);
  });

  test("没有 applied_at 但状态已在投递之后的也算投递", () => {
    const f = computeFunnel([
      r({ id: 1, status: "oa" }),
      r({ id: 2, status: "phone" }),
    ]);
    expect(f.stages[0].count).toBe(2);
  });

  test("found 与 closed 不算投递", () => {
    const f = computeFunnel([
      r({ id: 1, status: "found" }),
      r({ id: 2, status: "closed", outcome: "n_a" }),
    ]);
    expect(f.stages[0].count).toBe(0);
  });

  test("同时报出其中有几条是确切日期——缺口必须可见", () => {
    const f = computeFunnel([
      r({ id: 1, status: "applied", applied_at: "2026-08-01" }),
      r({ id: 2, status: "oa" }),
      r({ id: 3, status: "phone" }),
    ]);
    expect(f.stages[0].count).toBe(3);
    expect(f.appliedExact).toBe(1);
  });
});

describe("停留中位数：样本不足时不许编数字", () => {
  test("没有可算的样本时返回 null，不是 0", () => {
    const f = computeFunnel([r({ id: 1, status: "oa" })]);
    expect(f.medians).toBeNull();
  });

  /** 现有数据里 applied_at 与 first_response_at 全部同日，间隔恒为 0，没有信息量。 */
  test("间隔全为 0 的样本不构成有效样本", () => {
    const f = computeFunnel([
      r({ id: 1, status: "oa", applied_at: "2026-08-15",
          first_response_at: "2026-08-15 16:49" }),
      r({ id: 2, status: "oa", applied_at: "2026-08-13",
          first_response_at: "2026-08-13 17:22" }),
    ]);
    expect(f.medians).toBeNull();
  });
});

describe("真实台账口径", () => {
  test("455 线索 ┊ 投递 15 → 测评 9 → 面试 3 → offer 0", () => {
    const rows: LedgerRow[] = [];
    for (let i = 0; i < 420; i++) rows.push(r({ id: 1000 + i, status: "found" }));
    for (let i = 0; i < 35; i++)
      rows.push(r({ id: 2000 + i, status: "closed", outcome: "n_a" }));
    for (let i = 0; i < 4; i++) rows.push(r({ id: 3000 + i, status: "applied" }));
    for (let i = 0; i < 8; i++)
      rows.push(r({ id: 4000 + i, status: "oa", oa_at: i < 7 ? "2026-08-11" : null }));
    for (let i = 0; i < 3; i++)
      rows.push(r({ id: 5000 + i, status: "phone",
                    oa_at: i < 2 ? "2026-08-04" : null,
                    interview_at: "2026-08-05" }));

    const f = computeFunnel(rows);
    expect(f.leads).toEqual({ total: 455, pending: 420, archived: 35 });
    expect(f.stages.map((s) => s.count)).toEqual([15, 9, 3, 0]);
  });
});
