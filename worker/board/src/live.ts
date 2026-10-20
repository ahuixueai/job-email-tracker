import type { EmailRow, LiveData } from "@/lib/demo/liveData";

export { toLiveData } from "@/lib/demo/liveData";
export type { EmailRow, LiveData };

export interface NoticeRow {
  id: string;
  kind: string;
  received_at: string;
  subject: string;
  body: string;
}

/** 看板详情里「模型和规则各管什么」那句。 */
export function extractorNote(models: ReadonlyMap<string, string | null>, ids: readonly string[]): string {
  const used = [...new Set(ids.map((id) => models.get(id)).filter((m): m is string => typeof m === "string"))];
  return used.length > 0
    ? `公司、岗位、时间片段由模型从原文摘出（${used.join("、")}）；是什么事、什么时候、哪个时区由规则判断。`
    : "这封没有用到模型（没配置、你关掉了 AI、当天额度用完，或调用失败后退回了纯规则），全部由规则判断。";
}

/** 转发确认只看最近 7 天的：开通转发是一次性的，过期的不必一直挂着。 */
export const NOTICE_WINDOW_MS = 7 * 86_400_000;

/** 邮箱服务商自己的域名：确认信里只有指向这些域名的链接才做成按钮（防伪造的确认信骗人点链接）。 */
const TRUSTED_LINK_HOSTS = ["qq.com", "google.com", "163.com", "126.com", "yeah.net", "outlook.com", "live.com", "microsoft.com"];

function trustedLink(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && TRUSTED_LINK_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export interface ForwardingNotice {
  id: string;
  /** gmail：Gmail 的转发验证码；other：其他邮箱（QQ 等）的转发确认信。 */
  provider: "gmail" | "other";
  subject: string;
  receivedAt: string;
  code: string | null;
  /** 确认信里的按钮：文字 + 地址（只留服务商自己域名的）。 */
  links: { label: string; url: string }[];
  /** 正文开头一段：认不出验证码和按钮时整段给人看。 */
  excerpt: string;
}

/**
 * 还要处理的邮箱转发确认：Gmail 的验证码、QQ 等的确认链接。最新的在前。
 * - 只看最近 7 天；
 * - 点了确认按钮或「我已确认好了」就删掉（不靠「之后有没有信进来」判断：手动转发的信也会进来，会把还没确认的按钮藏掉，10/16 踩过）；
 * - 同一个邮箱重复申请了几次，只留最新那封（旧的验证码已经作废）。
 */
/** 同一个邮箱的转发确认归成一组：Gmail 的全算一组，其他按标题。 */
function noticeKey(notice: NoticeRow): string {
  return notice.kind === "gmail-forwarding" ? "gmail" : notice.subject;
}

/**
 * 点了确认（或「我已确认好了」）：同一个邮箱以前发来的旧确认也一起删掉。
 * 只删最新那封的话，下一封旧的会顶上来，再点它的链接 Gmail 会说验证失败（旧链接已作废，10/16 踩过）。
 */
export function noticeGroupIds(notices: readonly NoticeRow[], id: string): string[] {
  const target = notices.find((n) => n.id === id);
  if (!target) return [id];
  const key = noticeKey(target);
  return notices.filter((n) => n.kind === target.kind && noticeKey(n) === key).map((n) => n.id);
}

export function forwardingNotices(notices: readonly NoticeRow[], nowMs: number): ForwardingNotice[] {
  const out: ForwardingNotice[] = [];
  const seen = new Set<string>();
  for (const notice of notices) {
    if (notice.kind !== "gmail-forwarding" && notice.kind !== "forward-verify") continue;
    if (nowMs - Date.parse(notice.received_at) > NOTICE_WINDOW_MS) continue;
    const key = noticeKey(notice);
    if (seen.has(key)) continue;
    seen.add(key);
    const code = notice.kind === "gmail-forwarding" ? (/验证码：(\d{6,})/.exec(notice.body)?.[1] ?? null) : null;
    const links: { label: string; url: string }[] = [];
    for (const match of notice.body.matchAll(/([^\s（）()]{1,30})（(https?:\/\/[^\s）]+)）/g)) {
      const url = match[2];
      // 中文句子没有空格，前面会带上半句话：只留最后一个分句，去掉「请点击」
      const label = (match[1] ?? "").split(/[，。,.:：；;！!]/).pop()?.replace(/^(请)?(点击|点)/, "");
      if (label && url && trustedLink(url) && !links.some((l) => l.url === url)) links.push({ label, url });
    }
    // 纯文本里光秃秃的地址（Gmail 的确认信就是这样）：第一个就是确认链接，做成按钮；后面的（帮助页之类）不要
    if (links.length === 0) {
      for (const match of notice.body.matchAll(/https:\/\/[^\s（）()<>"']+/g)) {
        const url = match[0].replace(/[.,，。；;]+$/, "");
        if (trustedLink(url)) {
          links.push({ label: "一键确认转发", url });
          break;
        }
      }
    }
    const excerpt = notice.body.replace(/^发件人：[^\n]*\n+/, "").replace(/^验证码：\d+\n+/, "").slice(0, 600).trim();
    out.push({ id: notice.id, provider: notice.kind === "gmail-forwarding" ? "gmail" : "other", subject: notice.subject, receivedAt: notice.received_at, code, links, excerpt });
  }
  return out;
}
