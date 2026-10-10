import { describe, expect, test } from "vitest";
import { safeExternalUrl, validateAiCreateTask } from "@/lib/validation";

/**
 * 这几个字段最终会进 <a href>（components/PrepCapsule.tsx）。
 * React 19 目前会拦 javascript: 伪协议，但那是框架兜底不是我们的保证——
 * 换个渲染方式、换个版本就没了。协议白名单放在数据入口这一层。
 */
describe("safeExternalUrl", () => {
  test("放行 https", () => {
    expect(safeExternalUrl("https://meet.google.com/abc-defg-hij")).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
  });

  test("放行 http", () => {
    expect(safeExternalUrl("http://localhost:8080/room")).toBe(
      "http://localhost:8080/room",
    );
  });

  test("挡掉 javascript 伪协议", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
  });

  test("挡掉大小写混写与前导空白绕过", () => {
    expect(safeExternalUrl("  JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeExternalUrl("\tjavascript:alert(1)")).toBeNull();
  });

  test("挡掉 data 伪协议", () => {
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  test("挡掉 file 与其他协议", () => {
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBeNull();
  });

  test("不是合法 URL 的字符串一律挡掉", () => {
    expect(safeExternalUrl("随便写的一句话")).toBeNull();
    expect(safeExternalUrl("meet.google.com/abc")).toBeNull();
  });

  test("空值与非字符串返回 null", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
    expect(safeExternalUrl(42)).toBeNull();
  });

  test("首尾空白会被修掉，不因此判死", () => {
    expect(safeExternalUrl("  https://example.com/x  ")).toBe(
      "https://example.com/x",
    );
  });
});

describe("validateAiCreateTask", () => {
  const ok = { text: "下周三下午三点字节二面" };

  test("最小合法入参", () => {
    const result = validateAiCreateTask(ok);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.text).toBe("下周三下午三点字节二面");
  });

  test("text 两头空白被修掉", () => {
    const result = validateAiCreateTask({ text: "  字节二面  " });
    expect(result.ok && result.value.text).toBe("字节二面");
  });

  test.each([
    ["不是对象", "字符串", "_body"],
    ["缺 text", {}, "text"],
    ["text 是数字", { text: 42 }, "text"],
    ["text 全是空白", { text: "   " }, "text"],
    ["text 超长", { text: "字".repeat(501) }, "text"],
  ])("%s 时报在 %s 字段上", (_label, body, field) => {
    const result = validateAiCreateTask(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === field)).toBe(true);
  });

  test("时区必须是真的 IANA 名", () => {
    const bad = validateAiCreateTask({ ...ok, sourceTimeZone: "Asia/火星" });
    expect(bad.ok).toBe(false);
    expect(validateAiCreateTask({ ...ok, sourceTimeZone: "Asia/Tokyo" }).ok).toBe(true);
  });

  test("subCalendarId 只收安全字符", () => {
    expect(validateAiCreateTask({ ...ok, subCalendarId: "cal-1" }).ok).toBe(true);
    expect(validateAiCreateTask({ ...ok, subCalendarId: "../../etc" }).ok).toBe(false);
    expect(validateAiCreateTask({ ...ok, subCalendarId: "" }).ok).toBe(false);
  });

  test("now 必须能解析成时间", () => {
    expect(validateAiCreateTask({ ...ok, now: "2026-09-01T00:00:00Z" }).ok).toBe(true);
    expect(validateAiCreateTask({ ...ok, now: "明天" }).ok).toBe(false);
  });

  test("多个字段同时错时一次全报出来，不是遇错就停", () => {
    const result = validateAiCreateTask({ text: "", sourceTimeZone: "X/Y", now: "昨天" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBe(3);
  });
});
