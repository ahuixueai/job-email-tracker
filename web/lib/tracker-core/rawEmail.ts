// 生成物：由 scripts/sync-tracker-core.mjs 从 engine/src 同步而来，不要手改。
import type { UtcIsoString } from "./types";
import { normalizeText } from "./text";

/**
 * 收信管线的入口形态。
 *
 * 接入层（Cloudflare Email Workers）负责把 MIME 拆开、丢附件、HTML 转纯文本，
 * 到这一层只剩纯文本。方案 v0.2 第 6.1 节：**附件一律丢弃不解析**，
 * 原文处理完立即删除——所以本模块只做无状态转换，不持有任何原文。
 */

export interface RawEmail {
  /** 接入层分配的稳定标识，用于回溯到具体一封信。 */
  id: string;
  /** 发件人地址全文，可能带显示名，如 `Moka <no-reply@mail.mokahr.com>`。 */
  from: string;
  /** 用户专属收件地址 `u_xxx@inbox.…`，接入层据此定位用户。 */
  to: string;
  subject: string;
  /** 纯文本正文。 */
  body: string;
  /** 收信时刻（UTC）。相对期限（「72 小时内」）从它起算。 */
  receivedAtUtc: UtcIsoString;
}

/** 清洗后的邮件。解析层只看这个形态，不再碰 RawEmail。 */
export interface CleanEmail {
  id: string;
  /** 发件域名，小写，不含 `@`。取不到时为空串。 */
  senderDomain: string;
  /**
   * 发件人显示名（`云帆集团 <noreply@…>` 里的「云帆集团」）。没有时为空串。
   * 只作公司名的后备线索；可选，是为了不打扰只构造了旧字段的调用方。
   */
  senderName?: string;
  subject: string;
  body: string;
  /** 主题 + 正文，规则层大多数扫描直接用它。 */
  text: string;
  receivedAtUtc: UtcIsoString;
  /**
   * 内容指纹：同一封信被重复转发时值相同。
   * 与 dedup.ts 的 dedupKey 是两件事——rawHash 防「同一封信进两次」，
   * dedupKey 防「不同的信说同一件事」。
   */
  rawHash: string;
  /** 正文是否被截断。被截断时时间信息可能丢在尾部，置信度要相应保守。 */
  truncated: boolean;
}

/**
 * 正文长度上限。超出部分丢弃。
 *
 * 定这个上限是为了控制 LLM 成本，不是为了性能。8000 字符足够覆盖实测样本里
 * 最长的邮件，超长的基本是把整条邮件线索的历史都带上的转发。截断发生时会置
 * truncated=true 让下游知道，而不是静默丢信息。
 */
export const MAX_BODY_CHARS = 8000;

/** 引用块起始标记。转发和回复会把整条历史带进来，对解析只有干扰。 */
const QUOTE_MARKERS: readonly RegExp[] = [
  /^-{2,}\s*(原始邮件|原邮件|以下为转发的邮件|forwarded message)\s*-{2,}/im,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^在\s*\d{4}\s*年.{0,40}(写道|發送)[:：]?\s*$/im,
  /^On\s+.{0,80}\s+wrote:\s*$/im,
  /^(发件人|發件人|From)\s*[:：]\s*.{0,120}\n(收件人|發送時間|Sent|To)\s*[:：]/im,
  /**
   * 以下三条不要求换行，专门对付**被压平成单行**的正文（Gmail 摘要、某些接入层
   * 的 HTML 转文本都会这样）。上面几条都靠行首锚定，正文一旦没有换行就全部失效，
   * 引用历史里的旧时间会被当成本封信的时间——真实邮件评测里就有一封自动回复，
   * 把被引用的那封原信的「发送时间」读成了一场考试。
   *
   * 不靠行首，就必须靠更具体的形状来防误伤：
   *   - Outlook 引用头：发件人/From 后面同一段里紧跟「发送时间 / Sent」。
   *     只认 Sent 不认 To——「From: 10:00 To: 11:00」是正文里可能出现的时间段写法。
   *   - Gmail 引用头：「On <带四位年份的日期> … wrote:」「在 2026年… 写道：」。
   */
  /(?:发件人|發件人|From)\s*[:：][^\n]{0,160}?(?:发送时间|發送時間|Sent)\s*[:：]/i,
  /\bOn\s+(?:\w{3,9},?\s+)?\w{3,9}\.?\s+\d{1,2},?\s+\d{4}\b[^\n]{0,120}?\bwrote:/i,
  /在\s*\d{4}\s*年[^\n]{0,60}?(?:写道|寫道)[:：]/,
];

/** 从 `Name <a@b.com>` 里取显示名，去掉引号。没有尖括号（裸地址）时返回空串。 */
export function extractSenderName(from: string): string {
  const source = from ?? "";
  const angle = source.indexOf("<");
  if (angle <= 0) return "";
  return source
    .slice(0, angle)
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
}

/** 从 `Name <a@b.com>` 或 `a@b.com` 里取域名。取不到返回空串。 */
export function extractSenderDomain(from: string): string {
  const source = from ?? "";
  const angle = /<([^<>]+)>/.exec(source);
  const address = (angle?.[1] ?? source).trim();
  const at = address.lastIndexOf("@");
  if (at < 0) return "";
  return address
    .slice(at + 1)
    .trim()
    .replace(/[>\s.]+$/, "")
    .toLowerCase();
}

/**
 * 剥掉引用/转发的历史正文，只留最新一段。
 *
 * 转发是本产品唯一的接入方式，所以「正文里混着上一封信」是常态而不是例外。
 * 不剥的后果很具体：上一封信里的旧时间会和本封信的新时间一起被 findDates
 * 扫出来，改期通知反而解析出原定时间。
 */
export function stripQuoted(body: string): string {
  let text = body ?? "";

  let cut = text.length;
  for (const marker of QUOTE_MARKERS) {
    const hit = marker.exec(text);
    if (hit && hit.index < cut) cut = hit.index;
  }
  text = text.slice(0, cut);

  // 逐行剥掉 `>` 引用；只在行首命中时剥，避免误伤正文里的 `>` 符号
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

/** 折叠连续空行与行尾空白，让后续正则不必处理排版噪音。 */
export function collapseWhitespace(text: string): string {
  return (text ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 内容指纹。用 FNV-1a 变体（两路 32 位拼成 16 位十六进制）而不是 SHA-256：
 * 这个值只用来判「是不是同一封信又来了一次」，不承担任何安全性，
 * 不值得为它引入 node:crypto 依赖——本库要能在 Workers 运行时里直接跑。
 */
export function rawHashOf(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** RawEmail → CleanEmail。纯函数，不保留原文。 */
export function toCleanEmail(raw: RawEmail): CleanEmail {
  const subject = collapseWhitespace(normalizeText(raw.subject ?? ""));
  const stripped = collapseWhitespace(normalizeText(stripQuoted(raw.body ?? "")));
  const truncated = stripped.length > MAX_BODY_CHARS;
  const body = truncated ? stripped.slice(0, MAX_BODY_CHARS) : stripped;

  return {
    id: raw.id,
    senderDomain: extractSenderDomain(raw.from ?? ""),
    senderName: extractSenderName(raw.from ?? ""),
    subject,
    body,
    text: `${subject} ${body}`.trim(),
    receivedAtUtc: raw.receivedAtUtc,
    rawHash: rawHashOf(`${subject} ${body}`),
    truncated,
  };
}
