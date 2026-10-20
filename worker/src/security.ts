/**
 * 安全响应头。看板页面和接口分两套：
 *
 * - 页面（静态文件）：由 Cloudflare 静态资源层按 board-dist/_headers 加，Worker 代码碰不到这些响应。
 *   _headers 在构建时由 vite.config.ts 生成：内联脚本（index.html 里定深浅色那段）的哈希现算现填，
 *   改了脚本不会忘了改 CSP。
 * - 接口和日历（/api/*、/cal/*）：Worker 自己出的响应，在 index.ts 里套 withSecurityHeaders。
 *
 * 各条防什么：
 * - CSP：只许加载本站的脚本（外加 Cloudflare 人机验证），被注入的脚本跑不起来，也不能把数据发去别处
 * - frame-ancestors / X-Frame-Options：别的网站不能把看板套进框里骗你点（点击劫持）
 * - nosniff：浏览器不乱猜文件类型
 * - HSTS：只走 HTTPS
 * - Referrer-Policy：点出去的链接不带上看板地址
 * - Permissions-Policy：用不到的摄像头、麦克风、定位一律关掉
 */

/** 人机验证（Turnstile）要从这里加载脚本和框，见 Cloudflare 文档「Content Security Policy」。 */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** 看板页面的 CSP。scriptHashes 是内联脚本的 `sha256-…`（不带引号）。 */
export function boardCsp(scriptHashes: readonly string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.map((h) => `'${h}'`).join(" ")} ${TURNSTILE_ORIGIN}`.replace(/\s+/g, " "),
    // React 的 style 属性要 'unsafe-inline'；样式注入不能执行代码，风险远小于脚本
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${TURNSTILE_ORIGIN}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    // 简历 PDF 转文字用的 pdf.js 后台线程
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** 页面和接口都加的几条。 */
export const COMMON_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
};

/** 接口返回的是数据不是页面：什么都不许加载、不许被嵌。 */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/** 给 Worker 自己出的响应加上安全头（已有的同名头不覆盖）。 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(COMMON_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (!headers.has("content-security-policy")) headers.set("content-security-policy", API_CSP);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** 生成 board-dist/_headers 的内容。 */
export function headersFile(scriptHashes: readonly string[]): string {
  const lines = ["# 构建时由 vite.config.ts 生成，不要手改。说明见 src/security.ts。", "/*"];
  lines.push(`  Content-Security-Policy: ${boardCsp(scriptHashes)}`);
  for (const [name, value] of Object.entries(COMMON_SECURITY_HEADERS)) {
    lines.push(`  ${name.replace(/(^|-)([a-z])/g, (_m, dash: string, c: string) => dash + c.toUpperCase())}: ${value}`);
  }
  return `${lines.join("\n")}\n`;
}

/** 从 HTML 里取出所有内联脚本（不带 src 的 <script>）的内容。 */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    if ((m[1] ?? "").trim().length > 0) out.push(m[1] ?? "");
  }
  return out;
}
