import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api.js";
import { boardCsp, headersFile, inlineScripts, withSecurityHeaders } from "../src/security.js";
import { testDb } from "./testDb.js";

describe("安全响应头", () => {
  it("接口响应：带上全部安全头，原有的头不被覆盖", async () => {
    const original = new Response("{}", { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    const res = withSecurityHeaders(original);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("未登录访问接口：401，且不泄露任何数据", async () => {
    const { db } = testDb();
    const res = await handleApi(new Request("https://board.example/api/emails"), { DB: db }, Date.now());
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("emails");
  });

  it("页面 CSP：只许本站脚本 + 人机验证；禁止被嵌、禁止插件", () => {
    const csp = boardCsp(["sha256-abc"]);
    expect(csp).toContain("script-src 'self' 'sha256-abc' https://challenges.cloudflare.com");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("index.html 里的内联脚本取得出来（构建时据此算哈希）；_headers 格式对", () => {
    const html = readFileSync(new URL("../board/index.html", import.meta.url), "utf8");
    const scripts = inlineScripts(html);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("jcc_theme");
    const file = headersFile(["sha256-x"]);
    expect(file.split("\n")[1]).toBe("/*");
    expect(file).toContain("  Content-Security-Policy: default-src 'self';");
    expect(file).toContain("  X-Frame-Options: DENY");
  });
});
