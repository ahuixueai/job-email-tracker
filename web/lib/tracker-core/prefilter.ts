// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
import type { CleanEmail } from "./rawEmail";
import { isAtsDomain } from "./company";
import { isVerificationNoise } from "./noise";

/**
 * 零成本规则预筛。方案 v0.2 第 6.2 节的两级过滤的第一级：
 * 命中才调 LLM，控制成本。
 *
 * **这一层的取舍方向和解析层相反，这点必须说清楚。**
 *
 * 解析层的原则是「宁可漏报，不可错报」——不确定就降级、就不进主看板，
 * 因为错报会让用户信错时间。但预筛丢掉一封信是**终局**：这封信不会被抽取、
 * 不会入库、不会进待确认收件箱，用户永远不知道它存在过，连纠错的机会都没有。
 *
 * 所以预筛的默认动作是**放行**，只在有明确噪音证据时才丢。省下的那点 LLM
 * 成本，换不来一次「用户错过了唯一一封笔试通知」。
 */

export type PrefilterVerdict = "drop" | "pass";

export interface PrefilterResult {
  verdict: PrefilterVerdict;
  /** 判定依据，丢弃时必须能说清为什么，便于用户申诉与回流排查。 */
  reason: string;
  /** 命中的信号词，用于人工复核预筛质量。 */
  hits: readonly string[];
}


/**
 * 求职相关信号词。这张表**只用来决定要不要往下走**，不参与任何分类判定，
 * 所以它可以、也应该比 eventType.ts 的信号词表宽得多——宽一点只是多花
 * 一次 LLM 调用，窄一点是丢信。
 */
const JOB_SIGNALS: ReadonlyArray<readonly [string, RegExp]> = [
  ["简历", /简历|履历|\bresume\b|\bcv\b/i],
  ["申请投递", /申请|投递|应聘|报名|\bapplication\b|\bapplied\b|\bapply(?:ing)?\b|\bcandidate\b|\bcandidacy\b/i],
  [
    "流程环节",
    /面试|测评|笔试|试卷|宣讲|\binterview\b|\bassessment\b|online\s+test|phone\s+screen|screening\s+call|coding\s+(?:challenge|test)|take[-\s]home|case\s+study|\bsuperday\b|\b(?:HireVue|HackerRank|Codility|CodeSignal)\b/i,
  ],
  ["岗位", /岗位|职位|校招|秋招|春招|实习|\bposition\b|\brole\b|\binternship\b|\bcampus\b/i],
  ["结果", /录用|offer|不再推进|很遗憾|未通过|\bhired?\b|regret\s+to\s+inform|moving\s+forward/i],
  ["招聘方", /招聘|人才|\bhr\b|\brecruit\w*|\bhiring\b|\btalent\b|\bcareers?\b/i],
];

/** 扫出全部命中的信号类别名。 */
function jobSignalHits(text: string): string[] {
  const hits: string[] = [];
  for (const [label, pattern] of JOB_SIGNALS) {
    if (pattern.test(text)) hits.push(label);
  }
  return hits;
}

/**
 * 预筛。
 *
 * 丢弃只有三种情况，每一种都要求有正面证据：
 * 1. 空邮件——没有任何可解析内容
 * 2. 验证码/邮箱验证——只认「这封信就是验证码邮件」，正文顺带提到验证码的不算（见 noise.ts）
 * 3. 既无任何求职信号词、发件域名也不是已知 ATS——两个独立证据同时为否
 *
 * 第 3 条是省成本的主力。它之所以敢丢，是因为「求职信号词」这张表宽到
 * 只要邮件里出现「简历」「岗位」「面试」「recruit」等任意一个词就会放行；
 * 一封真实招聘邮件一个都不出现，实测样本里不存在。
 * 而 ATS 域名这一路又兜住了「正文是纯链接、词全在图片里」的极端情况。
 */
export function prefilter(email: CleanEmail): PrefilterResult {
  const text = email.text ?? "";

  if (text.trim().length === 0) {
    return { verdict: "drop", reason: "空邮件：主题与正文都为空", hits: [] };
  }

  if (isVerificationNoise(email.subject ?? "", email.body ?? "")) {
    return {
      verdict: "drop",
      reason: "命中验证码/邮箱验证：这类邮件形态固定，且从不携带求职流程信息",
      hits: ["噪音"],
    };
  }

  const hits = jobSignalHits(text);
  if (hits.length > 0) {
    return { verdict: "pass", reason: `命中求职信号：${hits.join("、")}`, hits };
  }

  if (email.senderDomain.length > 0 && isAtsDomain(email.senderDomain)) {
    return {
      verdict: "pass",
      reason: `正文无信号词，但发件域名 ${email.senderDomain} 是已知 ATS，照常放行`,
      hits: ["ats域名"],
    };
  }

  return {
    verdict: "drop",
    reason: "既无任何求职信号词，发件域名也不是已知 ATS",
    hits: [],
  };
}
