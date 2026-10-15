import PostalMime from "postal-mime";
import type { Address } from "postal-mime";
import { handleApi } from "./api.js";
import { handleCalendar } from "./calendar.js";
import { handleIncoming } from "./inbox.js";
import type { Env, ExecutionContext, ForwardableEmailMessage } from "./types.js";

function formatAddress(address: Address | undefined): string {
  if (!address) return "";
  if (address.address === undefined) return address.name;
  return address.name ? `${address.name} <${address.address}>` : address.address;
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
      {
        envelopeFrom: message.from,
        envelopeTo: message.to,
        headers: mail.headers.map((h) => ({ key: h.key, value: h.value })),
        from: formatAddress(mail.from),
        subject: mail.subject ?? "",
        text: mail.text,
        html: mail.html,
        date: mail.date,
        messageId: mail.messageId,
      },
      env,
      Date.now(),
      () => crypto.randomUUID(),
    );
    if (handling.kind === "rejected") message.setReject(handling.reason);
    // 日志只记结论，不记邮件内容
    console.log(JSON.stringify({ handling }));
  },

  /**
   * 私人看板：/api/* 走接口（登录、读邮件、存手动操作），其余都是看板的静态页面。
   * 静态页面本身不含任何邮件内容，不登录也只能看到登录框；数据全在 /api 后面、要登录才给。
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, Date.now());
    if (url.pathname.startsWith("/cal/")) return handleCalendar(request, env, Date.now());
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("看板还没有构建：先在 worker 目录运行 npm run build", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
