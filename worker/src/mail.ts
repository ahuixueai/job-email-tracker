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
 * 链接保留地址：「<a href="https://…">进入测评</a>」→「进入测评（https://…）」。很多信只有 HTML，
 * 测评入口、转发确认这类按钮的地址只在 href 里，去掉标签就丢了。
 * 常见实体（&gt; &amp; &nbsp; 和数字实体）在最后还原，「详情」里看原文时不会出现 &gt;。
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(https?:\/\/[^"']+)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, _q: string, href: string, inner: string) => {
      const url = decodeEntities(href).trim();
      const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      // 没有文字的（logo、横幅图片）不留地址，免得一串跟踪链接把正文挤到模型看不到的后面；
      // 文字本身就是这个地址：只留地址，不重复
      if (label.length === 0) return " ";
      return decodeEntities(label).includes(url) ? ` ${url} ` : `${label}（${url}）`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|blockquote)\s*>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return decodeEntities(text);
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** 优先用纯文本部分；没有，或纯文本只是一句「请用支持 HTML 的客户端查看」时，用 HTML 转。 */
export function pickBody(text: string | undefined, html: string | undefined): string {
  const plain = (text ?? "").trim();
  const fromHtml = html ? htmlToText(html) : "";
  if (plain.length === 0) return fromHtml;
  // 纯文本部分把链接丢了（QQ 邮箱的系统信就是这样），HTML 里有：用 HTML 转的，按钮地址才不会丢
  if (!/https?:\/\//.test(plain) && /https?:\/\//.test(fromHtml)) return fromHtml;
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
 * - **QQ 收信规则自动转发**：不加 X-Forwarded-For，发件人保留原信的，
 *   但信封发件人是「你的QQ号+auto_=收信地址@qq.com」（10/16 实测日志）。去掉「+」后面那段就是你的地址。
 * - **网易来信分类转发**：也不加 X-Forwarded-For，信封发件人是「auto_你的用户名+收信地址@163.com」，
 *   另带标准的 Resent-From 头（10/16 实测日志）。Resent-From 是通用的转发标记，别家也可能用。
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

  const forwardedFor = [...headerValues(headers, "x-forwarded-for"), ...headerValues(headers, "resent-from")].flatMap(addressesIn);
  if (forwardedFor.some((a) => allow.includes(a))) return { kind: "job", via: "auto" };
  if (from.some((a) => allow.includes(a)) || allow.includes(envelope)) return { kind: "job", via: "manual" };
  // QQ「QQ号+auto_=…@qq.com」、网易「auto_用户名+…@163.com」：去掉 auto_ 前缀和「+」后面那段
  const tagged = /^(?:auto_)?([^+@]+)\+[^@]*(@.+)$/.exec(envelope);
  if (tagged && allow.includes(`${tagged[1]}${tagged[2]}`)) return { kind: "job", via: "auto" };
  return { kind: "reject", reason: "发件人不在允许列表里" };
}

export interface ForwardedOriginal {
  from: string;
  subject: string;
  body: string;
}

/**
 * 各家邮箱手动转发时插入的分隔行：
 * Gmail「---------- Forwarded message ---------」、QQ「------------------ 原始邮件 ------------------」
 * （纯文本里常带着 &nbsp;，网页版转成文字后只剩「原始邮件」一行）、Outlook「-----Original Message-----」、
 * 网易「-------- 转发邮件信息 --------」。
 */
const FORWARD_MARK =
  /^[ \t]*(?:[-—_=]{2,}[ \t\u00a0]*)?(?:&nbsp;|[ \t\u00a0])*(?:Forwarded message|Original Message|原始邮件|原始郵件|已转发的邮件|轉寄的郵件|转发的邮件|转发邮件信息)(?:&nbsp;|[ \t\u00a0])*(?:[-—_=]{2,})?[ \t]*$/im;

/** 转发头里的一行「键: 值」。QQ 用「发件时间」，Outlook 用「发送时间」。 */
const HEADER_LINE =
  /^\s*(From|发件人|寄件者|Subject|主题|主旨|Date|Sent|日期|发件时间|发送时间|发送日期|寄件日期|To|收件人|Cc|抄送)\s*[:：]\s*(.*)$/i;
const FROM_LINE = /^\s*(?:From|发件人|寄件者)\s*[:：]/i;
const SUBJECT_LINE = /^\s*(?:Subject|主题|主旨)\s*[:：]/i;

/** 找转发头开始的那一行：先找分隔行；没有分隔行时（Outlook 只画一条下划线、有的版本什么都不画），找紧挨着的「发件人 … 主题」。 */
function forwardHeaderStart(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (FORWARD_MARK.test(lines[i] ?? "")) return i + 1;
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (!FROM_LINE.test(lines[i] ?? "")) continue;
    if (lines.slice(i + 1, i + 6).some((l) => SUBJECT_LINE.test(l))) return i;
  }
  return -1;
}

/**
 * 手动转发的信：把被转发的那封原信拆出来。
 *
 * 不拆的后果：解析引擎会把转发分隔行以下当成引用历史整段剥掉
 * （那是它防「上一封信的旧时间混进来」的手段），剩下的只有你自己写的空白转发说明；
 * 而且发件人是你自己，会被当成「你自己写的信」只存档。
 *
 * 认 Gmail、QQ、Outlook、网易的格式。认不出就返回 null，按普通信处理。
 */
export function unwrapManualForward(body: string): ForwardedOriginal | null {
  const all = body.split(/\r?\n/);
  const start = forwardHeaderStart(all);
  if (start < 0) return null;
  let i = start;
  while (i < all.length && (all[i] ?? "").trim().length === 0) i += 1;
  let from = "";
  let subject = "";
  // 头部是若干行「键: 值」，以第一个空行结束
  for (const limit = i + 12; i < all.length && i < limit; i += 1) {
    const line = all[i] ?? "";
    if (line.trim().length === 0) break;
    const m = HEADER_LINE.exec(line);
    if (!m) continue;
    const key = (m[1] ?? "").toLowerCase();
    const value = (m[2] ?? "").replace(/&nbsp;/g, " ").replace(/;\s*$/, "").trim();
    if (key === "from" || key === "发件人" || key === "寄件者") from = value;
    if (key === "subject" || key === "主题" || key === "主旨") subject = value;
  }
  if (from.length === 0 && subject.length === 0) return null;
  return { from, subject, body: all.slice(i).join("\n").trim() };
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
