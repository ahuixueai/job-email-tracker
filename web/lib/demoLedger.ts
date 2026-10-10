import type { LedgerRow } from "@/lib/funnel";

/**
 * 演示站用的假台账行。
 *
 * **它不是随手编的数字**：这些行会真的喂给 `computeFunnel()` 算一遍，
 * 所以演示站上看到的漏斗走的是和本机完全相同的计算路径。
 * 如果哪天 `computeFunnel` 改坏了，演示站会跟着错——这是想要的。
 *
 * 数字对齐 `mocks/interviews.ts` 的四条演示面试（字节/Stripe/Airbnb/Monzo），
 * 免得看板显示 4 场、漏斗却说面试级 0 条，自相矛盾。
 *
 * `applied_at` 只给一部分行——**故意的**。产品的一条设计主张是
 * 「推断出来的数和有确切日期的数必须分开报」（见 FunnelPanel 里那段提示），
 * 演示站要能看见这个行为，而不是一个假装数据很干净的漏斗。
 */
export function demoLedgerRows(): readonly LedgerRow[] {
  const rows: LedgerRow[] = [];
  let id = 1;

  const push = (r: Omit<LedgerRow, "id">) => rows.push({ id: id++, ...r });
  const blank = {
    applied_at: null,
    oa_at: null,
    interview_at: null,
    closed_at: null,
    outcome: null,
    first_response_at: null,
  };

  // 线索池：还没投的 / 已归档的。**隔在漏斗外**，不算投递。
  for (let i = 0; i < 31; i += 1) push({ status: "found", ...blank });
  for (let i = 0; i < 12; i += 1)
    push({ status: "closed", ...blank, closed_at: "2026-07-30" });

  // 投递级 24 条，其中 17 条有确切 applied_at，7 条靠状态推断（缺口要可见）。
  const day = (n: number) => `2026-08-${String(n).padStart(2, "0")}`;

  // 走到 offer 的 1 条
  push({
    status: "offer",
    applied_at: day(3),
    oa_at: day(5),
    interview_at: day(12),
    closed_at: null,
    outcome: "offer",
    first_response_at: day(4),
  });

  // 走到面试的 3 条（含被拒 1 条——累计口径下面试级仍然算它）
  push({
    status: "onsite",
    applied_at: day(4),
    oa_at: day(6),
    interview_at: day(14),
    closed_at: null,
    outcome: null,
    first_response_at: day(5),
  });
  push({
    status: "phone",
    applied_at: day(6),
    oa_at: day(9),
    interview_at: day(18),
    closed_at: null,
    outcome: null,
    first_response_at: day(7),
  });
  push({
    status: "rejected",
    applied_at: day(2),
    oa_at: day(4),
    interview_at: day(11),
    closed_at: day(16),
    outcome: "rejected",
    first_response_at: day(3),
  });

  // 只走到测评的 5 条
  for (let i = 0; i < 5; i += 1)
    push({
      status: "oa",
      applied_at: day(8 + i),
      oa_at: day(10 + i),
      interview_at: null,
      closed_at: null,
      outcome: null,
      first_response_at: day(9 + i),
    });

  // 投了、有确切日期、还没回音的 8 条
  for (let i = 0; i < 8; i += 1)
    push({ status: "applied", ...blank, applied_at: day(15 + (i % 6)) });

  // 投了但没记到日期的 7 条——状态已进到 oa/phone，说明必然投过。
  // 这 7 条撑起「投递 24 / 确切 17」的缺口提示。
  for (let i = 0; i < 4; i += 1)
    push({ status: "oa", ...blank, oa_at: day(19 + i) });
  for (let i = 0; i < 3; i += 1) push({ status: "applied", ...blank });

  return rows;
}
