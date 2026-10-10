import type { Interview } from "@/types";

/**
 * 紧急度分档：距开始时间越近分越高。
 * < 24h → 5 | 24~72h → 4 | 3~7d → 3 | 7~14d → 2 | > 14d → 1
 * 已开始（负数小时）视为最紧急。
 */
export function urgencyScore(hoursUntilStart: number): number {
  if (hoursUntilStart < 24) return 5;
  if (hoursUntilStart < 72) return 4;
  if (hoursUntilStart < 24 * 7) return 3;
  if (hoursUntilStart < 24 * 14) return 2;
  return 1;
}

/**
 * 优先级得分：score = importance × 10 + urgency × 15。
 * 紧急度权重高于重要度（15 > 10），所以「明天的普通面试」会排在
 * 「三周后的梦中情司」前面。
 *
 * 纯函数：`now` 由参数传入（毫秒时间戳），内部不读取 Date.now()，方便测试。
 */
export function calcPriority(interview: Interview, now: number): number {
  const startMs = Date.parse(interview.startUtc);
  const hoursUntilStart = (startMs - now) / 3_600_000;
  return interview.importance * 10 + urgencyScore(hoursUntilStart) * 15;
}

/** 得分上限（5 × 10 + 5 × 15 = 125），用于判定「最高优先级」标记。 */
export const MAX_PRIORITY_SCORE = 125;

/** 得分 ≥ 100 视为高优先级：会点亮强调黄标记。 */
export function isHighPriority(score: number): boolean {
  return score >= 100;
}

/** 终态（已 offer / 已挂）不参与优先级排序，统一沉底。 */
export function isSettled(interview: Interview): boolean {
  return interview.status === "offer" || interview.status === "rejected";
}

/**
 * 按优先级降序排序，终态沉底；同分时用开始时间升序做稳定兜底。
 * 不修改入参数组。
 */
export function sortByPriority(
  interviews: readonly Interview[],
  now: number,
): Interview[] {
  return [...interviews].sort((a, b) => {
    const settledDiff = Number(isSettled(a)) - Number(isSettled(b));
    if (settledDiff !== 0) return settledDiff;
    const scoreDiff = calcPriority(b, now) - calcPriority(a, now);
    if (scoreDiff !== 0) return scoreDiff;
    return Date.parse(a.startUtc) - Date.parse(b.startUtc);
  });
}
