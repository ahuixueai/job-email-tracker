import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api";
import { prepare } from "../src/prepare";
import type { Env } from "../src/types";
import { member, owner, setup } from "./helpers";

const PASSWORD = "test-password";
const NOW = Date.parse("2026-10-14T12:00:00Z");
const LLM = { LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "m" };

function env(over: Partial<Env> = {}): Env {
  return setup({ BOARD_PASSWORD: PASSWORD, ...LLM, ...over }).e;
}
const req = (path: string, init: { method?: string; body?: string; cookie?: string } = {}) =>
  new Request(`https://board.example${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}), "cf-connecting-ip": "203.0.113.9" },
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
async function login(e: Env): Promise<string> {
  const res = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) }), e, NOW);
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const REQUEST = { company: "星河科技", role: "产品经理", kind: "视频面试", when: null, emails: [{ subject: "面试邀请", body: "请准时参加二面", receivedAtUtc: "2026-10-10T00:00:00Z" }] };
const GOOD = JSON.stringify({ focus: [{ point: "用户洞察", basis: "面试邀请" }], questions: [{ type: "行为", q: "讲一次失败经历" }], stories: [], checklist: ["业务线"] });

function replying(content: string, seen: { body?: string } = {}) {
  return (_url: string, init: { body: string }) => {
    seen.body = init.body;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content } }] }) });
  };
}

describe("简历：只存文字，要登录", () => {
  it("存、读、删；空的和太长的拒绝", async () => {
    const e = env();
    expect((await handleApi(req("/api/resume"), e, NOW)).status).toBe(401);
    const cookie = await login(e);
    expect(await (await handleApi(req("/api/resume", { cookie }), e, NOW)).json()).toEqual({ resume: null });
    const put = await handleApi(req("/api/resume", { method: "PUT", cookie, body: JSON.stringify({ text: " 教育：星河大学 \n", fileName: "cv.pdf" }) }), e, NOW);
    expect(put.status).toBe(200);
    expect(await (await handleApi(req("/api/resume", { cookie }), e, NOW)).json()).toEqual({
      resume: { text: "教育：星河大学", fileName: "cv.pdf", updatedAt: "2026-10-14T12:00:00.000Z" },
    });
    expect((await handleApi(req("/api/resume", { method: "PUT", cookie, body: JSON.stringify({ text: "  " }) }), e, NOW)).status).toBe(400);
    expect((await handleApi(req("/api/resume", { method: "PUT", cookie, body: JSON.stringify({ text: "字".repeat(20_001) }) }), e, NOW)).status).toBe(400);
    expect((await handleApi(req("/api/resume", { method: "DELETE", cookie }), e, NOW)).status).toBe(200);
    expect(await (await handleApi(req("/api/resume", { cookie }), e, NOW)).json()).toEqual({ resume: null });
  });
});

describe("AI 面试准备", () => {
  it("有简历就带上；输出校验后返回", async () => {
    const e = env();
    const cookie = await login(e);
    await handleApi(req("/api/resume", { method: "PUT", cookie, body: JSON.stringify({ text: "星河科技 用户调研" }) }), e, NOW);
    const seen: { body?: string } = {};
    const r = await prepare(e, await owner(e), NOW, REQUEST, replying(GOOD, seen));
    expect(r).toMatchObject({ ok: true, usedResume: true, prep: { questions: [{ type: "行为", q: "讲一次失败经历" }] } });
    expect(seen.body).toContain("星河科技 用户调研");
    expect(seen.body).toContain("请准时参加二面");
  });

  it("没简历：照样生成，标明没用简历", async () => {
    const e = env();
    const r = await prepare(e, await owner(e), NOW, REQUEST, replying(GOOD));
    expect(r).toMatchObject({ ok: true, usedResume: false });
  });

  it("模型回的不是要的格式、模型挂了、请求不对、没配置模型：都给明白的错误", async () => {
    const e = env();
    const me = await owner(e);
    expect(await prepare(e, me, NOW, REQUEST, replying('{"questions":[]}'))).toMatchObject({ ok: false, status: 502 });
    expect(await prepare(e, me, NOW, REQUEST, () => Promise.reject(new Error("down")))).toMatchObject({ ok: false, status: 502 });
    expect(await prepare(e, me, NOW, { company: "星河科技" })).toMatchObject({ ok: false, status: 400 });
    const noModel = env({ LLM_API_KEY: "" });
    expect(await prepare(noModel, await owner(noModel), NOW, REQUEST)).toMatchObject({ ok: false, status: 503 });
  });

  it("关了 AI、额度用完：不调模型，说清楚原因", async () => {
    const e = env({ AI_DAILY_LIMIT: "1" });
    let calls = 0;
    const counting = (url: string, init: { body: string }) => {
      calls += 1;
      return replying(GOOD)(url, init);
    };
    const off = await member(e, "off@x.example", { ai_enabled: 0 });
    expect(await prepare(e, off, NOW, REQUEST, counting)).toMatchObject({ ok: false, status: 403, error: expect.stringContaining("关掉了 AI") });
    const m = await member(e, "m@x.example");
    expect(await prepare(e, m, NOW, REQUEST, counting)).toMatchObject({ ok: true });
    expect(await prepare(e, m, NOW, REQUEST, counting)).toMatchObject({ ok: false, status: 403, error: expect.stringContaining("额度用完") });
    expect(calls).toBe(1);
  });
});
