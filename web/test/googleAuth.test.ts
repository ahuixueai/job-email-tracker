import { describe, expect, test } from "vitest";
import { buildAuthUrl } from "@/lib/integrations/googleAuth";
import { GOOGLE_SCOPES } from "@/lib/integrations/googleEnv";

const env = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "secret",
  redirectUri: "http://localhost:3000/api/integrations/google/callback",
  sessionSecret: "x".repeat(48),
};

describe("buildAuthUrl", () => {
  const url = new URL(buildAuthUrl(env, "state-abc123"));

  test("指向 Google 的同意页", () => {
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  test("带上 state：回调时要逐字比对，少了它就是 OAuth CSRF", () => {
    expect(url.searchParams.get("state")).toBe("state-abc123");
  });

  test("只申请 GOOGLE_SCOPES 里列的权限，一个不多", () => {
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...GOOGLE_SCOPES]);
  });

  test("同意页上不出现任何 Gmail 权限", () => {
    expect(url.searchParams.get("scope")).not.toContain("gmail");
  });

  test("access_type=offline + prompt=consent，否则拿不到 refresh_token", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  test("回调地址与 client_id 照传", () => {
    expect(url.searchParams.get("redirect_uri")).toBe(env.redirectUri);
    expect(url.searchParams.get("client_id")).toBe(env.clientId);
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  test("client_secret 绝不出现在跳转地址里", () => {
    expect(url.toString()).not.toContain(env.clientSecret);
  });
});
