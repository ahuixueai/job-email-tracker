import { describe, expect, it } from "vitest";
import { quickAdd } from "../src/quickAdd";
import type { Env } from "../src/types";

const ENV = { LLM_API_KEY: "k", LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "m" } as unknown as Env;

function replying(content: string, seen: { body?: string } = {}) {
  return (_url: string, init: { body: string }) => {
    seen.body = init.body;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content } }] }) });
  };
}

describe("一句话添加的模型调用", () => {
  it("只要名字和类型；名字不在原话里就丢掉；原话作为数据发出去", async () => {
    const seen: { body?: string } = {};
    const r = await quickAdd(ENV, "周四下午3点美团二面", replying('{"company":"美团","role":"产品经理","kindHint":"interview"}', seen));
    expect(r).toEqual({ ok: true, model: { company: "美团", role: null, kindHint: "interview" } });
    expect(seen.body).toContain("周四下午3点美团二面");
  });

  it("模型挂了：照样返回（名字空着），并说明", async () => {
    const r = await quickAdd(ENV, "周四美团二面", () => Promise.reject(new Error("down")));
    expect(r.ok && r.model.company === null && r.warning?.includes("没响应")).toBe(true);
  });

  it("空话、太长、没配置模型：拒绝", async () => {
    expect(await quickAdd(ENV, "  ")).toMatchObject({ ok: false, status: 400 });
    expect(await quickAdd(ENV, "字".repeat(201))).toMatchObject({ ok: false, status: 400 });
    expect(await quickAdd({} as Env, "周四美团二面")).toMatchObject({ ok: false, status: 503 });
  });
});
