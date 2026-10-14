// 生成物：由 scripts/sync-tracker-core.mjs 从 engine/src 同步而来，不要手改。
/**
 * 行动信息：做这件事要用到的**入口链接**和**凭据**（测评密钥、考试码、会议号……）。
 *
 * 这一层全部用规则，不交给模型，原因有两条：
 *
 * 1. 链接和密钥必须**逐字正确**。模型把 `Xk7-92Qp` 抄成 `Xk7-92Op`，用户就登不进去，
 *    而且看不出哪里错了。正则摘出来的要么一字不差，要么没有。
 * 2. 它们本来就有稳定的形态（`https://…`、「密钥：xxxx」），不需要理解语义。
 *
 * 只摘、不判断、不访问：这里从不请求任何链接，也不判断链接是否可信——
 * 那是展示层要提醒用户的事。
 */

export interface Credential {
  /** 信里对它的叫法，如「测评密钥」「会议号」。原样保留，用户照着找输入框。 */
  label: string;
  value: string;
}

export interface ActionInfo {
  /** 入口链接，最像「去做这件事」的排在最前。不含退订、隐私政策这类页脚链接。 */
  links: readonly string[];
  credentials: readonly Credential[];
}

export const EMPTY_ACTION_INFO: ActionInfo = { links: [], credentials: [] };

const MAX_LINKS = 5;
const MAX_CREDENTIALS = 4;

/** URL 到这些字符为止。中文邮件里链接后面常直接跟全角标点，不能吃进去。 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`，。；、！？（）【】「」《》]+/gi;

/** 页脚链接：与「做这件事」无关，放进详情只会让人点错。 */
const FOOTER_LINK = /unsubscribe|退订|privacy|隐私|terms|条款|preferences|help|faq|support/i;

/** 链接前面出现这些词，说明它是入口。 */
const ENTRY_CUE =
  /测评|笔试|考试|面试|作答|入口|登录|链接|点击|会议|assessment|test|exam|interview|join|start|begin|launch|link|click/i;

function trimUrl(raw: string): string {
  // 句末的半角标点属于句子，不属于链接
  return raw.replace(/[.,;:!?)\]}>]+$/, "");
}

export function extractLinks(text: string): string[] {
  const source = text ?? "";
  const found: { url: string; cued: boolean; order: number }[] = [];
  const seen = new Set<string>();
  let order = 0;
  for (const match of source.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (url.length < 12 || seen.has(url) || FOOTER_LINK.test(url)) continue;
    seen.add(url);
    const before = source.slice(Math.max(0, (match.index ?? 0) - 30), match.index ?? 0);
    found.push({ url, cued: ENTRY_CUE.test(before), order });
    order += 1;
  }
  // 有入口提示词的排前面，其余保持原文顺序
  found.sort((a, b) => Number(b.cued) - Number(a.cued) || a.order - b.order);
  return found.slice(0, MAX_LINKS).map((f) => f.url);
}

/**
 * 凭据的叫法。长的排前面，避免「测评密钥」只匹配到「密钥」。
 *
 * ⚠️ 不含「验证码」：登录验证码是一次性的、几分钟就失效，而且整封信在预筛就被
 * 丢掉了；把它当凭据存下来既没用，也是不该留的东西。
 */
const CODE_LABEL =
  "测评密钥|测评码|考试密钥|考试码|准考证号|邀请码|授权码|登录码|登录密码|初始密码|会议密码|入会密码|密钥|口令|密码" +
  "|access\\s*code|pass\\s*code|invitation\\s*code|invite\\s*code|exam\\s*code|test\\s*code|password|passcode|pin";

/**
 * 「标签：值」。值是一段不含空白的串，至少 4 位：字母数字开头，
 * 中间允许密码里常见的符号（`Xh@2026`、`BC-7Q2M`）。
 */
const CODE_PATTERN = new RegExp(
  `(${CODE_LABEL})\\s*(?:[:：]|为|是|is)?\\s*([A-Za-z0-9][A-Za-z0-9_@#$%&*+=!.-]{3,31})(?![A-Za-z0-9])`,
  "gi",
);

/** 会议号单独处理：它是带空格或连字符分组的数字，如「123 456 789」。 */
const MEETING_PATTERN =
  /(会议号|会议\s*ID|meeting\s*(?:id|number))\s*(?:[:：]|为|是|is)?\s*(\d{3,4}(?:[\s-]?\d{3,4}){1,3})/gi;

export function extractCredentials(text: string): Credential[] {
  const source = text ?? "";
  const out: Credential[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: string): void => {
    const cleanLabel = label.replace(/\s+/g, " ").trim();
    const cleanValue = value.trim();
    if (seen.has(cleanValue) || out.length >= MAX_CREDENTIALS) return;
    seen.add(cleanValue);
    out.push({ label: cleanLabel, value: cleanValue });
  };
  for (const m of source.matchAll(MEETING_PATTERN)) push(m[1] ?? "", m[2] ?? "");
  for (const m of source.matchAll(CODE_PATTERN)) {
    // 句末的 . 和 ! 属于句子，不属于凭据
    const value = (m[2] ?? "").replace(/[.!]+$/, "");
    // 纯字母的多半是普通单词（「密码 error」「password reset」），真凭据几乎都带数字
    if (!/\d/.test(value)) continue;
    push(m[1] ?? "", value);
  }
  return out;
}

export function extractActionInfo(text: string): ActionInfo {
  return { links: extractLinks(text), credentials: extractCredentials(text) };
}
