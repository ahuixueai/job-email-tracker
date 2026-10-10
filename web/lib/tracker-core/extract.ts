// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
import type { EventType } from "./types";
import { isEventType } from "./types";
import type { CleanEmail } from "./rawEmail";
import { normalizeText } from "./text";

/**
 * LLM 抽取层。
 *
 * **本层的宪法：LLM 只抽取事实片段，不做任何判定。**
 *
 * 时间语义（deadline 还是 fixed_start）、时区推断、去重键、置信度分级，
 * 全部留在 1.1 的确定性规则里。理由不是不信任模型，是这四件事的共同特征：
 * 判错代价最大，且必须能向用户解释「为什么是这个结论」。规则错了能定位到
 * 具体哪一条并修掉，模型错了只能重试。
 *
 * 所以这里的输出全是**原文片段**：公司名怎么写的、岗位叫什么、哪句话在说时间、
 * 哪个词是地点。这些是规则做不好而模型做得好的部分——中文公司全称的边界、
 * 一封信里哪段是正事哪段是页脚。
 */

export interface Extraction {
  /** 公司名原样，不做归一化——归一交给 company.ts。 */
  companyRaw: string | null;
  /** 岗位名原样。 */
  roleRaw: string | null;
  /** 地点短语，喂给 timezone.ts 的地点推断。 */
  locationRaw: string | null;
  /**
   * 与截止/场次有关的那一小段原文。
   * 为 null 时下游用全文兜底——少一层裁剪，不会因此漏掉时间。
   */
  timeText: string | null;
  /**
   * 事件类型的建议值。**只在规则完全没有结论时才会被采纳，且采纳后置信度
   * 强制降到 low 进待确认收件箱**，见 pipeline.ts。它的作用是提升召回，
   * 不是覆盖规则。
   */
  eventTypeHint: EventType | null;
  /** 模型认为这封信与求职无关。同样只作为降级依据，不作为丢弃依据。 */
  notJobRelated: boolean;
}

export interface LLMExtractor {
  extract(email: CleanEmail): Promise<Extraction>;
}

export const EMPTY_EXTRACTION: Extraction = {
  companyRaw: null,
  roleRaw: null,
  locationRaw: null,
  timeText: null,
  eventTypeHint: null,
  notJobRelated: false,
};

/** 单个字段的长度上限，防模型把整封信塞进某个字段。 */
const MAX_FIELD_CHARS = 200;

function cleanField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = normalizeText(value).trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_FIELD_CHARS);
}

/** 去掉所有空白后比对，避免因换行/空格差异误判为幻觉。 */
function densify(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * 接地检查：字段必须是邮件原文里真实出现过的片段。
 *
 * 这是对幻觉最有效的一道防线，而且很便宜。timeText 和 locationRaw 直接决定
 * 「几点」和「哪个时区」，模型只要编出一个原文没有的「8月20日」或「深圳」，
 * 用户看到的就是一个自信而错误的时刻——正是方案 4.2 节要防的那类错报。
 *
 * companyRaw 不做这个检查：模型经常需要从发件域名或签名档重构公司全名，
 * 那本来就不是逐字摘抄；而且公司名判错的下游是 normalizeCompany，
 * 它认不出就 matched=false，不会误合并，损失可控。
 */
export function isGrounded(fragment: string, sourceText: string): boolean {
  const needle = densify(fragment);
  if (needle.length === 0) return false;
  return densify(sourceText).includes(needle);
}

/**
 * 校验并收敛模型输出。
 *
 * 立场沿用 types.ts：**在边界上挡掉脏值，比让它流进数据层再排查便宜得多。**
 * 任何不认识的形状都收敛成 null 或 false，绝不抛异常——一封信解析得不完整
 * 可以进待确认收件箱，整条管线因为模型多吐了个字段而崩掉不行。
 */
export function validateExtraction(value: unknown, sourceText: string): Extraction {
  if (typeof value !== "object" || value === null) return { ...EMPTY_EXTRACTION };
  const raw = value as Record<string, unknown>;

  const timeText = cleanField(raw["timeText"]);
  const locationRaw = cleanField(raw["locationRaw"]);
  const hintValue = raw["eventTypeHint"];

  return {
    companyRaw: cleanField(raw["companyRaw"]),
    roleRaw: cleanField(raw["roleRaw"]),
    locationRaw: locationRaw !== null && isGrounded(locationRaw, sourceText) ? locationRaw : null,
    timeText: timeText !== null && isGrounded(timeText, sourceText) ? timeText : null,
    eventTypeHint: isEventType(hintValue) ? hintValue : null,
    notJobRelated: raw["notJobRelated"] === true,
  };
}

/**
 * 公司名的几个高频标题模式。实测样本里绝大多数 ATS 通知的标题都长这样。
 * 只匹配结构清晰的，匹配不上就返回 null——桩宁可少给，也不给一个错公司名。
 */
const SUBJECT_COMPANY: readonly RegExp[] = [
  /^来自(.{2,30}?)的(?:.{0,10})?(?:邀请|通知|反馈|回复|更新)/,
  /^【(.{2,30}?)】/,
  /^\[(.{2,30}?)\]/,
  /^(.{2,20}?)(?:校园招聘|校招|秋季招聘|春季招聘)/,
  /^(.{2,20}?)(?:测评|笔试|面试|录用)(?:邀请|通知)/,
];

/**
 * 桩实现。**它不是 LLM 的替代品，是管线的脚手架。**
 *
 * 存在的唯一目的：让 parseEmail 现在就能端到端跑通、能被测试、能被下游依赖，
 * 而不必等到有 API key 和真实邮件流。它只做几条高置信度的标题模式匹配，
 * 匹配不上就老实返回 null，绝不为了「看起来能用」而猜。
 *
 * 换成真实 Haiku 调用时，本文件其余部分（接口、校验、接地检查）全部不动，
 * 只多一个实现类——这正是先定接口的意义。
 */
export class StubExtractor implements LLMExtractor {
  extract(email: CleanEmail): Promise<Extraction> {
    return Promise.resolve({
      ...EMPTY_EXTRACTION,
      companyRaw: this.companyFrom(email.subject),
    });
  }

  private companyFrom(subject: string): string | null {
    for (const pattern of SUBJECT_COMPANY) {
      const hit = pattern.exec(subject);
      const value = hit?.[1]?.trim();
      if (value !== undefined && value.length >= 2) return value;
    }
    return null;
  }
}
