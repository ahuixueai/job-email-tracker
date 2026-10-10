/**
 * 求职漏斗的纯计算层。输入是 ledger.db 的 applications 行，输出面板要显示的数字。
 *
 * 不碰 IO、不读时钟——数据从 /api/funnel 进来，这里只算。
 */

/** applications 表里漏斗用得到的那几列。 */
export interface LedgerRow {
  id: number;
  status: string;
  applied_at: string | null;
  oa_at: string | null;
  interview_at: string | null;
  closed_at: string | null;
  outcome: string | null;
  first_response_at: string | null;
}

export interface FunnelStage {
  key: "applied" | "oa" | "interview" | "offer";
  label: string;
  count: number;
}

export interface FunnelData {
  /** 线索池。**隔在漏斗外**——它不是漏斗的一级，混进去就是自欺。 */
  leads: { total: number; pending: number; archived: number };
  stages: FunnelStage[];
  /** 投递级里有确切 applied_at 的条数。缺口必须可见。 */
  appliedExact: number;
  /** 每级停留中位数。样本不足时是 null，**绝不填 0 或占位数字**。 */
  medians: null | { appliedToOa: number; oaToInterview: number };
}

/** 已经投递过的状态。能走到这几个状态，必然投过。 */
const POST_APPLY = new Set(["applied", "oa", "phone", "onsite", "offer", "rejected"]);

/** 还没进漏斗的状态。closed 是过期/僵尸自动归档的线索，从来没投过。 */
const LEAD_ONLY = new Set(["found", "closed"]);

function has(v: string | null): boolean {
  return typeof v === "string" && v.trim() !== "";
}

export function computeFunnel(rows: readonly LedgerRow[]): FunnelData {
  let pending = 0;
  let archived = 0;
  let applied = 0;
  let appliedExact = 0;
  let oa = 0;
  let interview = 0;
  let offer = 0;

  for (const row of rows) {
    const status = (row.status || "").trim();

    if (LEAD_ONLY.has(status)) {
      if (status === "found") pending += 1;
      else archived += 1;
      continue;
    }

    // 投递级两条路都认：
    // applied_at 只有 8/50 有值，但状态已经进到 oa/phone 的记录一定投过——
    // 没投过不可能收到测评邀请。只按 applied_at 数会漏掉 7 条真实投递。
    // 代价是这一级混了「确切日期」和「推断」两种来源，所以另外报 appliedExact。
    if (has(row.applied_at) || POST_APPLY.has(status)) {
      applied += 1;
      if (has(row.applied_at)) appliedExact += 1;
    }

    // 其余各级严格按「有对应时间戳」算，不看当前 status。
    // 这样才是累计的：一条已经进到面试的记录，它的 oa_at 还在，测评级不会因此少一条。
    if (has(row.oa_at)) oa += 1;
    if (has(row.interview_at)) interview += 1;
    if ((row.outcome || "").trim() === "offer") offer += 1;
  }

  return {
    leads: { total: pending + archived, pending, archived },
    stages: [
      { key: "applied", label: "投递", count: applied },
      { key: "oa", label: "测评", count: oa },
      { key: "interview", label: "面试", count: interview },
      { key: "offer", label: "offer", count: offer },
    ],
    appliedExact,
    // 停留中位数暂不计算。
    //
    // 现有数据里 applied_at 与 first_response_at 全部落在同一天，间隔恒为 0——
    // 因为首封邮件是网申提交后的自动回复（「简历成功投递通知」「测评邀请」），
    // 测的是自动回复有多快，不是对方多久看了你的简历。这个数没有信息量。
    //
    // 真要算得先区分 ack_at（自动回复）与 first_response_at（实质进展），
    // 判据本身还需要语料验证。见「下次开工」。**在那之前一律 null，不填占位数字。**
    medians: null,
  };
}
