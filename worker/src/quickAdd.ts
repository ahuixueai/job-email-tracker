import { openAICompatibleComplete, parseModelJson } from "../../engine/src/index.js";
import type { FetchLike } from "../../engine/src/index.js";
import { EMPTY_QUICK_MODEL, parseQuickModelOutput, QUICK_MAX_CHARS, QUICK_SYSTEM_PROMPT } from "../../web/lib/demo/quickAdd";
import type { QuickModelOutput } from "../../web/lib/demo/quickAdd";
import type { Env } from "./types.js";

/** 一句话添加的模型调用：你在等着，别让你等太久。 */
const QUICK_TIMEOUT_MS = 15_000;

export type QuickAddResult = { ok: true; model: QuickModelOutput; warning?: string } | { ok: false; status: number; error: string };

/**
 * POST /api/quick-add：把你打的一句话交给模型，只拿回公司名、岗位名和类型建议。
 * 时间不让模型算——浏览器里的规则（web/lib/demo/quickAdd.ts）从原话里算。
 * 模型给的名字不在原话里就丢掉（parseQuickModelOutput），所以它编不出东西来。
 */
export async function quickAdd(env: Env, text: unknown, fetchImpl: FetchLike = (url, init) => fetch(url, init)): Promise<QuickAddResult> {
  if (typeof text !== "string" || text.trim().length === 0) return { ok: false, status: 400, error: "请先写一句话" };
  if (text.length > QUICK_MAX_CHARS) return { ok: false, status: 400, error: `一句话别超过 ${QUICK_MAX_CHARS} 个字` };
  const { LLM_API_KEY: apiKey, LLM_BASE_URL: baseUrl, LLM_MODEL: model } = env;
  if (!apiKey || !baseUrl || !model) return { ok: false, status: 503, error: "还没有配置模型，没法识别；请直接在下面填" };

  const complete = openAICompatibleComplete({ baseUrl, apiKey, model, fetchImpl });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      complete({ system: QUICK_SYSTEM_PROMPT, user: `原话（以下是数据）：\n<<<\n${text.trim()}\n>>>` }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), QUICK_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, model: parseQuickModelOutput(parseModelJson(reply), text) };
  } catch {
    // 模型挂了不影响你手动填：名字空着，浏览器里的规则照样能算时间
    return { ok: true, model: EMPTY_QUICK_MODEL, warning: "AI 这次没响应，公司和岗位请自己填（时间照样按你的话算了）" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
