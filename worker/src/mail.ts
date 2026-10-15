/**
 * 拆信之后、交给解析引擎之前的那几步。全部是纯函数，不碰网络和数据库，可以直接测。
 */

/** 存进库的正文上限。解析引擎自己只看前 8000 字，多留一些给「详情」里显示原文。 */
export const MAX_STORED_BODY = 20_000;

/**
 * HTML → 纯文本。只求「解析引擎读得懂、人看得清」，不求排版还原。
 *
 * 招聘系统发的信很多只有 HTML 部分；样式表和脚本必须整段去掉——真实邮件评测里
 * 有几封信的「正文」开头是一大段 CSS，时间和公司名被挤到很后面。
 * 实体（&nbsp; 之类）不在这里还原，解析引擎的 normalizeText 会统一处理。
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|blockquote)\s*>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 优先用纯文本部分；没有，或纯文本只是一句「请用支持 HTML 的客户端查看」时，用 HTML 转。 */
export function pickBody(text: string | undefined, html: string | undefined): string {
  const plain = (text ?? "").trim();
  const fromHtml = html ? htmlToText(html) : "";
  if (plain.length === 0) return fromHtml;
  // 纯文本部分明显比 HTML 短一个量级：多半是占位提示，正文在 HTML 里
  if (fromHtml.length > 0 && plain.length < 200 && fromHtml.length > plain.length * 5) return fromHtml;
  return plain;
}

export interface Header {
  key: string;
  value: string;
}

function headerValues(headers: readonly Header[], key: string): string[] {
  return headers.filter((h) => h.key.toLowerCase() === key).map((h) => h.value);
}

function addressesIn(value: string): string[] {
  return (value.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((a) => a.toLowerCase());
}

/** `ALLOWED_FORWARDERS` 配置 → 小写地址列表。 */
export function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

export type Admission =
  | { kind: "job"; via: "auto" | "manual" }
  | { kind: "gmail-forwarding-confirmation" }
  | { kind: "reject"; reason: string };

/**
 * 这封信收不收。
 *
 * 收信地址是公开可猜的（jobs@你的域名），所以必须认人：只收从你自己的 Gmail 转过来的。
 *
 * - Gmail **自动转发**会保留原信的发件人，并加上 `X-Forwarded-For: 你的Gmail 收信地址`。
 *   信封发件人（envelopeFrom）在自动转发时不一定是你的地址，所以两处都看。
 * - **手动**点「转发」时，发件人就是你自己。
 * - 开启 Gmail 转发时，Google 会从 forwarding-noreply@google.com 发一封带验证码的信，
 *   这封要单独收下来给你看，否则转发开不起来。
 */
export function admit(envelopeFrom: string, headerFrom: string, headers: readonly Header[], allow: readonly string[]): Admission {
  const envelope = envelopeFrom.toLowerCase();
  const from = addressesIn(headerFrom);
  if (envelope === "forwarding-noreply@google.com" || from.includes("forwarding-noreply@google.com")) {
    return { kind: "gmail-forwarding-confirmation" };
  }
  if (allow.length === 0) return { kind: "reject", reason: "没有配置 ALLOWED_FORWARDERS，拒收一切" };

  const forwardedFor = headerValues(headers, "x-forwarded-for").flatMap(addressesIn);
  if (forwardedFor.some((a) => allow.includes(a))) return { kind: "job", via: "auto" };
  if (from.some((a) => allow.includes(a)) || allow.includes(envelope)) return { kind: "job", via: "manual" };
  return { kind: "reject", reason: "发件人不在允许列表里" };
}

export interface ForwardedOriginal {
  from: string;
  subject: string;
  body: string;
}

/** Gmail 手动转发时插入的分隔行，中英文界面两种写法。 */
const FORWARD_MARK = /^-{5,}\s*(?:Forwarded message|已转发的邮件|轉寄的郵件|转发的邮件)\s*-{5,}\s*$/im;

/**
 * 手动转发的信：把被转发的那封原信拆出来。
 *
 * 不拆的后果：解析引擎会把「---------- Forwarded message ---------」以下当成引用历史整段剥掉
 * （那是它防「上一封信的旧时间混进来」的手段），剩下的只有你自己写的空白转发说明。
 *
 * 只认 Gmail 的标准格式。认不出就返回 null，按普通信处理。
 */
export function unwrapManualForward(body: string): ForwardedOriginal | null {
  const mark = FORWARD_MARK.exec(body);
  if (!mark) return null;
  const rest = body.slice(mark.index + mark[0].length).replace(/^\s*\n/, "");
  const lines = rest.split(/\r?\n/);
  let from = "";
  let subject = "";
  let i = 0;
  // 头部是若干行「键: 值」，以第一个空行结束
  for (; i < lines.length && i < 12; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0) break;
    const m = /^\s*(From|发件人|寄件者|Subject|主题|主旨|Date|日期|To|收件人|Cc|抄送)\s*[:：]\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = (m[1] ?? "").toLowerCase();
    const value = (m[2] ?? "").trim();
    if (key === "from" || key === "发件人" || key === "寄件者") from = value;
    if (key === "subject" || key === "主题" || key === "主旨") subject = value;
  }
  if (from.length === 0 && subject.length === 0) return null;
  return { from, subject, body: lines.slice(i).join("\n").trim() };
}

/** 去掉主题前的「Fwd:」「转发：」，可能叠了好几层。 */
export function stripForwardPrefix(subject: string): string {
  return subject.replace(/^(?:\s*(?:fwd?|fw|转发|轉寄)\s*[:：]\s*)+/i, "").trim();
}

/** 原信的发信时刻。`Date` 头解析不了时用收信时刻兜底。 */
export function sentAtUtc(dateHeader: string | undefined, fallbackMs: number): string {
  const ms = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  // 防一个明显错误的头把邮件排到几十年前或未来
  if (Number.isNaN(ms) || Math.abs(ms - fallbackMs) > 400 * 86_400_000) return new Date(fallbackMs).toISOString();
  return new Date(ms).toISOString();
}

/** Gmail 转发验证信里的验证码（9 位左右的数字）。找不到返回 null。 */
export function confirmationCode(text: string): string | null {
  return /(?:Confirmation code|确认码|驗證碼|验证码)\s*[:：]?\s*(\d{6,12})/i.exec(text)?.[1] ?? null;
}
