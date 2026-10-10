import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { GOOGLE_SCOPES, readGoogleEnv } from "@/lib/integrations/googleEnv";

describe("GOOGLE_SCOPES", () => {
  /**
   * gmail.readonly 是 Google 的 restricted scope，一旦申请就要过 CASA Tier 2
   * 安全评估（$3,000+/年且每年复审）。docs/PROJECT-MEMORY.md 的既定决策是
   * 邮件走转发、不走 Gmail OAuth——这里申请了就等于把那笔成本又背上了。
   */
  test("不申请任何 Gmail 权限", () => {
    expect(GOOGLE_SCOPES.filter((s) => s.includes("gmail"))).toEqual([]);
  });

  test("日历权限只要只读", () => {
    const calendar = GOOGLE_SCOPES.filter((s) => s.includes("calendar"));
    expect(calendar).toEqual(["https://www.googleapis.com/auth/calendar.readonly"]);
  });
});

describe("readGoogleEnv", () => {
  const KEYS = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "JCC_SESSION_SECRET",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("全缺时列出缺的项，而不是抛错", () => {
    const result = readGoogleEnv();
    expect(result.configured).toBe(false);
    if (result.configured) return;
    expect(result.missing).toContain("GOOGLE_CLIENT_ID");
    expect(result.missing).toContain("GOOGLE_CLIENT_SECRET");
  });

  test("会话密钥短于 32 字符视为没配", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.JCC_SESSION_SECRET = "x".repeat(31);

    const result = readGoogleEnv();

    expect(result.configured).toBe(false);
    if (!result.configured) {
      expect(result.missing.some((m) => m.includes("JCC_SESSION_SECRET"))).toBe(true);
    }
  });

  test("配齐后回填默认回调地址", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.JCC_SESSION_SECRET = "x".repeat(32);

    const result = readGoogleEnv();

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.redirectUri).toBe(
        "http://localhost:3000/api/integrations/google/callback",
      );
    }
  });
});
