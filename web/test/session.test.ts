import { describe, expect, test } from "vitest";
import {
  openSession,
  sealSession,
  sessionCookieOptions,
  type GoogleSession,
} from "@/lib/integrations/session";

const SECRET = "x".repeat(48);
const OTHER_SECRET = "y".repeat(48);

const session: GoogleSession = {
  refreshToken: "1//refresh-token-value",
  account: "me@example.com",
  accessToken: "ya29.access",
  accessTokenExpiresAt: 1_800_000_000_000,
};

describe("sealSession / openSession 往返", () => {
  test("封上再打开，内容一字不差", () => {
    expect(openSession(sealSession(session, SECRET), SECRET)).toEqual(session);
  });

  test("密文里不出现明文令牌", () => {
    const sealed = sealSession(session, SECRET);
    expect(sealed).not.toContain(session.refreshToken);
    expect(sealed).not.toContain(session.account);
  });

  test("每次封装的密文都不同（随机 IV）", () => {
    expect(sealSession(session, SECRET)).not.toBe(sealSession(session, SECRET));
  });
});

describe("openSession 的拒绝路径", () => {
  test("换了密钥打不开", () => {
    expect(openSession(sealSession(session, SECRET), OTHER_SECRET)).toBeNull();
  });

  /**
   * 翻首位字符而不是末位：base64url 末位字符里有几位是填充位，
   * 改它解出来可能还是同样的字节，测试会时灵时不灵（实测 5 次挂 3 次）。
   * 首位一定落在有效位上。
   */
  const flipFirst = (segment: string) =>
    (segment[0] === "A" ? "B" : "A") + segment.slice(1);

  /** GCM 的认证标签就是干这个的：改一个字节就必须打不开，而不是解出半截。 */
  test("密文被改过就打不开", () => {
    const [iv, tag, body] = sealSession(session, SECRET).split(".");
    expect(openSession([iv, tag, flipFirst(body)].join("."), SECRET)).toBeNull();
  });

  test("认证标签被改过就打不开", () => {
    const [iv, tag, body] = sealSession(session, SECRET).split(".");
    expect(openSession([iv, flipFirst(tag), body].join("."), SECRET)).toBeNull();
  });

  test("IV 被改过就打不开", () => {
    const [iv, tag, body] = sealSession(session, SECRET).split(".");
    expect(openSession([flipFirst(iv), tag, body].join("."), SECRET)).toBeNull();
  });

  test.each([
    ["undefined", undefined],
    ["空串", ""],
    ["段数不对", "只有一段"],
    ["段数不对（两段）", "a.b"],
    ["不是 base64url", "!!!.???.###"],
  ])("%s 一律返回 null，不抛异常", (_label, input) => {
    expect(openSession(input as string | undefined, SECRET)).toBeNull();
  });

  /** 解得开但结构不对（比如换了版本、被人手工造过）也要当没有。 */
  test("解得开但缺 refreshToken 也返回 null", () => {
    const bogus = sealSession(
      { account: "me@example.com" } as unknown as GoogleSession,
      SECRET,
    );
    expect(openSession(bogus, SECRET)).toBeNull();
  });
});

describe("sessionCookieOptions", () => {
  test("永远是 httpOnly + SameSite=Lax", () => {
    const opts = sessionCookieOptions(false);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  test("secure 由调用方按协议决定", () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
    expect(sessionCookieOptions(false).secure).toBe(false);
  });
});
