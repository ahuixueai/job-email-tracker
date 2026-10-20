import { describe, expect, it } from "vitest";
import { quickAdd } from "../src/quickAdd";
import type { Env } from "../src/types";
import { member, owner, setup } from "./helpers";

const LLM = { LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "m" };
const NOW = Date.parse("2026-10-14T12:00:00Z");
const ENV: Env = setup(LLM).e;

function replying(content: string, seen: { body?: string } = {}) {
  return (_url: string, init: { body: string }) => {
    seen.body = init.body;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content } }] }) });
  };
}

describe("一句话添加的模型调用", () => {
  it("只要名字和类型；名字不在原话里就丢掉；原话作为数据发出去", async () => {
    const seen: { body?: string } = {};
    const r = await quickAdd(ENV, await owner(ENV), NOW, "周四下午3点星河科技二面", replying('{"company":"星河科技","role":"产品经理","kindHint":"interview"}', seen));
    expect(r).toEqual({ ok: true, model: { company: "星河科技", role: null, kindHint: "interview" } });
    expect(seen.body).toContain("周四下午3点星河科技二面");
  });

  it("模型挂了：照样返回（名字空着），并说明", async () => {
    const r = await quickAdd(ENV, await owner(ENV), NOW, "周四星河科技二面", () => Promise.reject(new Error("down")));
    expect(r.ok && r.model.company === null && r.warning?.includes("没响应")).toBe(true);
  });

  it("空话、太长、没配置模型：拒绝", async () => {
    const me = await owner(ENV);
    expect(await quickAdd(ENV, me, NOW, "  ")).toMatchObject({ ok: false, status: 400 });
    expect(await quickAdd(ENV, me, NOW, "字".repeat(201))).toMatchObject({ ok: false, status: 400 });
    expect(await quickAdd({ ...ENV, LLM_API_KEY: "" }, me, NOW, "周四星河科技二面")).toMatchObject({ ok: false, status: 503 });
  });

  it("关了 AI：不调模型，名字空着，说明原因", async () => {
    const e = setup(LLM).e;
    const off = await member(e, "off@x.example", { ai_enabled: 0 });
    const r = await quickAdd(e, off, NOW, "周四星河科技二面", () => Promise.reject(new Error("不该调")));
    expect(r).toMatchObject({ ok: true, model: { company: null }, warning: expect.stringContaining("你关掉了 AI") });
  });
});
