// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
import type { EventType } from "./types";

/**
 * 事件的**形式**：同样叫「面试」，电话面、视频面、AI 面要做的准备完全不同——
 * 要不要找安静的地方、要不要开摄像头、对面是不是真人。eventType 只回答
 * 「这是哪一类事」，本模块回答「以什么方式进行」。
 *
 * 与 eventType 的关系：形式是在 eventType 之下再分，不是另一套分类。
 * 所以只在 assessment / interview 两类里判，其余一律 not_applicable。
 *
 * 判不出就老实返回 unspecified。信里没写是电话还是视频的面试邀请很常见，
 * 猜一个比承认不知道更糟——用户会按错误的形式去准备。
 */
export type EventFormat =
  /** 在线测评：性格、认知、行测等，通常是一个期限内自行完成 */
  | "online_assessment"
  /** 笔试：有题目要作答的考试，常有固定开考时间 */
  | "written_test"
  /** AI 面试 / 录制式视频面试：对着系统作答，没有真人面试官在线 */
  | "ai_interview"
  /** 电话面试 */
  | "phone_interview"
  /** 视频面试：真人面试官在线 */
  | "video_interview"
  /** 线下面试：需要到场 */
  | "onsite_interview"
  /** 是测评或面试，但信里没说明形式 */
  | "unspecified"
  /** 这类事件谈不上形式（投递回执、结果通知等） */
  | "not_applicable";

export interface EventFormatClassification {
  format: EventFormat;
  /** 判定依据：命中的原文片段。没有命中时说明为什么定不下来。 */
  reason: string;
}

type Rule = readonly [EventFormat, RegExp];

/**
 * 面试类的判定顺序。**AI 面试必须排在视频面试前面**：AI 面试的通知里几乎
 * 总会出现「视频」二字（「AI 视频面试」「录制视频作答」），先判视频就全错了。
 * 电话排在视频前面，是因为「电话面试」是明确表述，而视频类的线索里有
 * 「会议链接」这种较宽的词。
 */
const INTERVIEW_RULES: readonly Rule[] = [
  [
    "ai_interview",
    /AI\s*(?:视频)?\s*面试|AI\s*面|智能面试|机器人面试|录制(?:式|视频)?.{0,6}(?:面试|作答)|AI[-\s]?(?:powered\s+)?(?:video\s+)?interview|(?:asynchronous|on[-\s]?demand|pre[-\s]?recorded|one[-\s]?way)\s+(?:video\s+)?interview|HireVue/i,
  ],
  ["phone_interview", /电话面试|电话面|电话沟通|电话初筛|phone\s+(?:interview|screen(?:ing)?)|telephone\s+interview/i],
  [
    "video_interview",
    /视频面试|线上面试|远程面试|视频面|video\s+(?:interview|call)|virtual\s+interview|腾讯会议|飞书(?:视频)?会议|钉钉会议|\bZoom\b|Microsoft\s+Teams|Google\s+Meet|会议号|会议链接/i,
  ],
  [
    "onsite_interview",
    /线下面试|现场面试|到场面试|面试地点|on[-\s]?site\s+interview|in[-\s]?person\s+interview|face[-\s]to[-\s]face\s+interview|\bin\s+person\b|\bon[-\s]?site\b|at\s+our\s+(?:[A-Z][\w.]*\s+){0,3}office\b/i,
  ],
];

/** 测评类：笔试优先于测评——「笔试」是更具体的说法，同时出现时以它为准。 */
const ASSESSMENT_RULES: readonly Rule[] = [
  ["written_test", /笔试|机考|written\s+(?:test|exam)|online\s+(?:test|exam)|coding\s+(?:test|challenge)|technical\s+test|\b(?:HackerRank|Codility|CodeSignal)\b/i],
  ["ai_interview", INTERVIEW_RULES[0]?.[1] ?? /$^/],
  ["online_assessment", /测评|性格测试|认知测试|行测|assessment|aptitude\s+test|psychometric/i],
];

function firstMatch(text: string, rules: readonly Rule[]): EventFormatClassification | null {
  for (const [format, pattern] of rules) {
    const hit = pattern.exec(text);
    if (hit) return { format, reason: `原文出现「${hit[0]}」` };
  }
  return null;
}

/** 信里明写的形式字段：「面试方式：视频面试」「面试形式: 电话」。只取冒号后面那一小段。 */
const FORMAT_FIELD = /(?:面试|考试|测评|笔试)(?:方式|形式)\s*[:：]\s*([^\n。；;]{1,20})/;

/**
 * 按「可信程度」从高到低找三遍：明写的形式字段 → 标题 → 全文。
 *
 * 原先只扫全文，命中的第一个词就算数。真实邮件里这会被注意事项和流程说明带偏：
 *   - 标题是「在线测评邀请」，注意事项里一句「可重新登录笔试页面继续作答」→ 判成笔试
 *   - 标题是「人才测评环节」，结尾一句「后续还有 1 轮 AI 面试」→ 判成 AI 面试
 *   - 「面试方式：视频面试」写得明明白白，后面一句「有临时转为电话面的可能」→ 判成电话面
 * 这些词都真实出现在信里，但说的不是这件事本身。字段和标题是发信人对
 * 「这是什么」的直接陈述，正文靠后的部分更可能是在说别的。
 */
function tiered(
  rules: readonly Rule[],
  text: string,
  subject: string,
): EventFormatClassification | null {
  const field = FORMAT_FIELD.exec(text);
  if (field) {
    const hit = firstMatch(field[1] ?? "", rules);
    if (hit) return { format: hit.format, reason: `${hit.reason}（形式字段「${field[0].trim()}」）` };
  }
  if (subject.length > 0) {
    const hit = firstMatch(subject, rules);
    if (hit) return { format: hit.format, reason: `${hit.reason}（标题）` };
  }
  return firstMatch(text, rules);
}

/**
 * @param text 主题 + 正文
 * @param eventType 已经判好的事件类型（催办邮件传它的 mergeAs，即被提醒的那件事）
 * @param subject 可选。单独的标题；给了就优先看标题，不给则只扫全文
 */
export function classifyEventFormat(
  text: string,
  eventType: EventType,
  subject = "",
): EventFormatClassification {
  const source = text ?? "";
  const title = subject ?? "";
  if (eventType === "interview") {
    return (
      tiered(INTERVIEW_RULES, source, title) ?? {
        format: "unspecified",
        reason: "是面试，但信里没有说明是电话、视频、AI 还是线下",
      }
    );
  }
  if (eventType === "assessment") {
    return (
      tiered(ASSESSMENT_RULES, source, title) ?? {
        format: "unspecified",
        reason: "是测评类，但信里没有说明具体形式",
      }
    );
  }
  return { format: "not_applicable", reason: "这类事件不区分形式" };
}
