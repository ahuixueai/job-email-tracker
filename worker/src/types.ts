/**
 * 本项目用到的那一小部分 Workers 运行时类型。
 * 不引 @cloudflare/workers-types 整包：只用到四五个接口，手写更好读，也不跟着它的大版本变。
 */

export interface ForwardableEmailMessage {
  /** 信封发件人（SMTP MAIL FROM）。 */
  readonly from: string;
  /** 信封收件人。 */
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface OutgoingEmail {
  from: string | { email: string; name?: string };
  to: string | { email: string; name?: string };
  subject: string;
  text?: string;
  html?: string;
}

export interface Env {
  DB: D1Database;
  ALLOWED_FORWARDERS?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  /** 用 `wrangler secret put LLM_API_KEY` 设置，不写进任何文件。 */
  LLM_API_KEY?: string;
  /** 作者账号的备用登录密码（邮箱验证码收不到时用）。用 `wrangler secret put BOARD_PASSWORD` 设置。 */
  BOARD_PASSWORD?: string;
  /** 签 cookie、算验证码哈希的钥匙。用 `wrangler secret put SESSION_SECRET` 设置；没设时退回用看板密码。 */
  SESSION_SECRET?: string;
  /** 作者账号的邮箱（第 1 期只有这一个账号）。 */
  OWNER_EMAIL?: string;
  /** 登录验证码从这个地址发出（域名要在 Cloudflare Email Service 里开通）。 */
  LOGIN_FROM?: string;
  /** Cloudflare Turnstile（防机器人）：公开的站点密钥写在 wrangler.toml，私密的用 `wrangler secret put TURNSTILE_SECRET`。 */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** Cloudflare Email Service 的发信绑定。 */
  EMAIL?: { send(message: OutgoingEmail): Promise<{ messageId: string }> };
  /** 只在本地开发（.dev.vars）里设成 "1"：跳过防机器人、验证码直接显示在页面上。配了 TURNSTILE_SECRET 就不生效。 */
  DEV_INSECURE_AUTH?: string;
  /** 看板的静态文件（Vite 构建产物）。 */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
