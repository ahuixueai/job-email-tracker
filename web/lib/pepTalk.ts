import type { Interview } from "@/types";
import { calcPriority, isHighPriority } from "@/lib/priority";

export type PepTone = "dense" | "daily";

export interface PepTalk {
  tone: PepTone;
  text: string;
}

const DAY_MS = 86_400_000;

/**
 * 文案基调：不升压。
 * 不写「加油、冲刺、决战、拼了」，方向是把注意力从整张日程表收回到眼前这一件事。
 */
const DAILY: readonly string[] = [
  "今天只有一件事要准备。后面那几场还没到需要你操心的时候。",
  "简历那部分已经过了，接下来只是把它再讲一遍。",
  "面试官今天也在赶自己的活。这事没那么隆重。",
  "准备到能自然讲完一个项目就够了。再往下就是焦虑在加班。",
  "日程表看着排得满，其实每天只需要处理今天那一格。",
  "不确定的那部分先放着。到时候现场想，也来得及。",
  "今天这场结束就关掉。复盘留到明天，今晚不算数。",
];

const DENSE: readonly string[] = [
  "这几天挨得紧，但它们互不相干。一场结束就清空一次。",
  "密集不等于难。只是需要你别在两场之间反复回放上一场。",
  "按顺序来。列表已经排好了，第一行之后的事晚点再说。",
  "连着面的好处是状态是热的，坏处是容易一直绷着。中间记得吃饭。",
  "这几天有两场重要的。它们不会因为你多担心一小时就变简单。",
  "排得满的那几天，最该省下来的是「先准备哪个」这个纠结。",
  "几场之间彼此不认识。上一场的发挥不会被下一场知道。",
];

/**
 * 判定密集档：未来 3 天内有 ≥ 2 场高优先级面试。
 *
 * 刻意按「天」而不是按毫秒判定——第一轮的首帧用的是 UTC 零点锚点、
 * hydration 后才换成真实时间。以天为粒度，两者落在同一天就得到同一个结论，
 * 文案不会在 hydration 后跳一下。
 */
export function countUrgentHighPriority(
  interviews: readonly Interview[],
  now: number,
): number {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const windowEnd = dayStart + 3 * DAY_MS;
  return interviews.filter((item) => {
    if (item.status !== "scheduled") return false;
    const start = Date.parse(item.startUtc);
    if (start < dayStart || start > windowEnd) return false;
    return isHighPriority(calcPriority(item, dayStart));
  }).length;
}

/** 字符串化的日期做种子，保证同一天内选中的文案稳定，不随重渲染乱换。 */
function seedFromDay(dayIndex: number): number {
  let h = 2166136261 ^ dayIndex;
  h = Math.imul(h ^ (h >>> 13), 16777619);
  return (h ^ (h >>> 16)) >>> 0;
}

export function pickPepTalk(
  interviews: readonly Interview[],
  now: number,
): PepTalk {
  const tone: PepTone =
    countUrgentHighPriority(interviews, now) >= 2 ? "dense" : "daily";
  const pool = tone === "dense" ? DENSE : DAILY;
  const dayIndex = Math.floor(now / DAY_MS);
  return { tone, text: pool[seedFromDay(dayIndex) % pool.length] };
}

export const PEP_TALK_POOLS = { DAILY, DENSE } as const;
