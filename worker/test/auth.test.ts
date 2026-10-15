import { describe, expect, it } from "vitest";
import { issueSession, passwordMatches, readCookie, sessionCookie, sessionUser, signingSecret } from "../src/auth.js";

const NOW = Date.parse("2026-10-12T04:00:00Z");

describe("看板登录", () => {
  it("密码比对：对的通过，错的、空的、只差一位的都不通过", async () => {
    expect(await passwordMatches("correct horse", "correct horse")).toBe(true);
    expect(await passwordMatches("correct hors", "correct horse")).toBe(false);
    expect(await passwordMatches("", "correct horse")).toBe(false);
    // 没设密码时任何输入都不能登录，包括空字符串
    expect(await passwordMatches("", "")).toBe(false);
  });

  it("会话：带上是谁；30 天内有效，过期、篡改、换钥匙、冒充别人都失效", async () => {
    const { value, maxAge } = await issueSession("k1", "user-a", NOW);
    expect(maxAge).toBe(30 * 86_400);
    expect(await sessionUser(value, "k1", NOW + 1000)).toBe("user-a");
    expect(await sessionUser(value, "k1", NOW + 31 * 86_400_000)).toBeNull();
    expect(await sessionUser(value, "k2", NOW + 1000)).toBeNull();

    const [uid, expires, sig] = value.split(".") as [string, string, string];
    expect(await sessionUser(`${uid}.${Number(expires) + 86_400_000}.${sig}`, "k1", NOW)).toBeNull();
    expect(await sessionUser(`user-b.${expires}.${sig}`, "k1", NOW)).toBeNull();
    const flipped = `${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
    expect(await sessionUser(`${uid}.${expires}.${flipped}`, "k1", NOW)).toBeNull();
    // 升级前的旧 cookie（没有用户 id）：无效，重新登录一次
    expect(await sessionUser(`${expires}.${sig}`, "k1", NOW)).toBeNull();
    expect(await sessionUser(null, "k1", NOW)).toBeNull();
    expect(await sessionUser("garbage", "k1", NOW)).toBeNull();
    expect(await sessionUser(value, "", NOW)).toBeNull();
  });

  it("签名钥匙：有 SESSION_SECRET 用它，没有退回看板密码", () => {
    expect(signingSecret({ SESSION_SECRET: "s", BOARD_PASSWORD: "p" })).toBe("s");
    expect(signingSecret({ BOARD_PASSWORD: "p" })).toBe("p");
    expect(signingSecret({})).toBe("");
  });

  it("cookie：只给 HTTPS、页面脚本读不到、不随别的网站请求发出", () => {
    const header = sessionCookie("abc.def", 100);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
    expect(readCookie("a=1; it_session=abc.def; b=2", "it_session")).toBe("abc.def");
    expect(readCookie("a=1", "it_session")).toBeNull();
    expect(readCookie(null, "it_session")).toBeNull();
  });
});
