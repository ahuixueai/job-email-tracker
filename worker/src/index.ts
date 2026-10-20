import PostalMime from "postal-mime";
import type { Address, Email } from "postal-mime";
import { handleApi } from "./api.js";
import { handleCalendar } from "./calendar.js";
import { handleIncoming, MAX_ATTACHED_MESSAGES } from "./inbox.js";
import type { IncomingMail } from "./inbox.js";
import { runMonitor } from "./monitor.js";
import { withSecurityHeaders } from "./security.js";
import { pruneSecurityLogs } from "./privacy.js";
import type { Env, ExecutionContext, ForwardableEmailMessage } from "./types.js";
import { runReminders } from "./reminders.js";

/** 和 wrangler.toml 里那一条一字不差。 */
const REMINDER_CRON = "*/15 * * * *";

function formatAddress(address: Address | undefined): string {
  if (!address) return "";
  if (address.address === undefined) return address.name;
  return address.name ? `${address.name} <${address.address}>` : address.address;
}

function toIncoming(mail: Email, envelopeFrom: string, envelopeTo: string): IncomingMail {
  return {
    envelopeFrom,
    envelopeTo,
    headers: mail.headers.map((h) => ({ key: h.key, value: h.value })),
    from: formatAddress(mail.from),
    subject: mail.subject ?? "",
    text: mail.text,
    html: mail.html,
    date: mail.date,
    messageId: mail.messageId,
  };
}

/** 作为附件夹带的整封信（.eml / message/rfc822）：解析出来，交给收信逻辑逐封处理。解析不了的跳过。 */
async function attachedMessages(mail: Email): Promise<IncomingMail[]> {
  const out: IncomingMail[] = [];
  for (const a of mail.attachments) {
    if (out.length >= MAX_ATTACHED_MESSAGES) break;
    if (a.mimeType.toLowerCase() !== "message/rfc822" && !/\.eml$/i.test(a.filename ?? "")) continue;
    try {
      out.push(toIncoming(await PostalMime.parse(a.content), "", ""));
    } catch {
      // 坏的附件不影响别的
    }
  }
  return out;
}

/**
 * 收信程序入口。Cloudflare Email Routing 把发到 jobs@你的域名 的信交给 `email()`。
 *
 * 这里只做 MIME 拆信，其余全部在 inbox.ts（可测）。
 */
export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    const raw = await new Response(message.raw).arrayBuffer();
    const mail = await PostalMime.parse(raw);
    const handling = await handleIncoming(
      { ...toIncoming(mail, message.from, message.to), attached: await attachedMessages(mail) },
      env,
      Date.now(),
      () => crypto.randomUUID(),
    );
    if (handling.kind === "rejected") message.setReject(handling.reason);
    // 日志只记结论，不记邮件内容
    console.log(JSON.stringify({ handling }));
  },

  /**
   * 定时任务（wrangler.toml 的 [triggers]）：
   * - 每 15 分钟：给每个人发该发的邮件提醒（面试前一晚、截止前 24 / 3 小时）
   * - 每 6 小时：收信监控（AI 失败多、收信断了、处理出错，就给作者发提醒），顺带清掉过期的登录 IP 记录
   */
  async scheduled(controller: { cron?: string }, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === REMINDER_CRON) {
      ctx.waitUntil(
        runReminders(env, Date.now()).then(
          (r) => console.log(JSON.stringify({ reminders: r })),
          (error: unknown) => console.log(JSON.stringify({ reminders: { failed: error instanceof Error ? error.message : String(error) } })),
        ),
      );
      return;
    }
    // 顺带清掉过期的登录 IP 记录（隐私政策承诺 2 天删）
    ctx.waitUntil(pruneSecurityLogs(env, Date.now()).catch(() => undefined));
    ctx.waitUntil(
      runMonitor(env, Date.now()).then(
        (r) => console.log(JSON.stringify({ monitor: { problems: r.problems.map((p) => p.key), alerted: r.alerted } })),
        (error: unknown) => console.log(JSON.stringify({ monitor: { failed: error instanceof Error ? error.message : String(error) } })),
      ),
    );
  },

  /**
   * 私人看板：/api/* 走接口（登录、读邮件、存手动操作），其余都是看板的静态页面。
   * 静态页面本身不含任何邮件内容，不登录也只能看到登录框；数据全在 /api 后面、要登录才给。
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // 页面的安全头在 board-dist/_headers（静态资源层加）；Worker 自己出的响应在这里加
    if (url.pathname.startsWith("/api/")) return withSecurityHeaders(await handleApi(request, env, Date.now()));
    if (url.pathname.startsWith("/cal/")) return withSecurityHeaders(await handleCalendar(request, env, Date.now()));
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("看板还没有构建：先在 worker 目录运行 npm run build", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
