import { openAICompatibleComplete, parseModelJson } from "../../engine/src/index.js";
import type { FetchLike } from "../../engine/src/index.js";
import { buildPrepUserPrompt, MAX_RESUME_CHARS, parsePrepOutput, parsePrepRequest, PREP_SYSTEM_PROMPT } from "../../web/lib/demo/prep";
import type { PrepOutput } from "../../web/lib/demo/prep";
import type { User } from "./accounts.js";
import { takeAiCall } from "./ai.js";
import { getUserSetting } from "./store.js";
import type { Env } from "./types.js";

/** 写准备要点比摘片段慢得多；你在页面上等着，但给足时间。 */
const PREP_TIMEOUT_MS = 90_000;

export interface StoredResume {
  text: string;
  fileName: string | null;
  updatedAt: string;
}

export async function loadResume(env: Env, userId: string): Promise<StoredResume | null> {
  const value = await getUserSetting(env, userId, "resume");
  if (value === null) return null;
  try {
    const v = JSON.parse(value) as Partial<StoredResume>;
    return typeof v.text === "string" && v.text.trim().length > 0
      ? { text: v.text, fileName: typeof v.fileName === "string" ? v.fileName : null, updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "" }
      : null;
  } catch {
    return null;
  }
}

/** 存简历：只存文字（浏览器里提取好、你核对过的），不存原文件。 */
export function resumeToStore(body: unknown, nowMs: number): StoredResume | string {
  const v = (typeof body === "object" && body !== null ? body : {}) as { text?: unknown; fileName?: unknown };
  if (typeof v.text !== "string" || v.text.trim().length === 0) return "简历是空的";
  if (v.text.length > MAX_RESUME_CHARS) return `简历太长了（超过 ${MAX_RESUME_CHARS} 字），删掉一些再存`;
  const fileName = typeof v.fileName === "string" && v.fileName.trim().length > 0 ? v.fileName.trim().slice(0, 120) : null;
  return { text: v.text.trim(), fileName, updatedAt: new Date(nowMs).toISOString() };
}

export type PrepareResult = { ok: true; prep: PrepOutput; usedResume: boolean } | { ok: false; status: number; error: string };

/**
 * POST /api/prepare：这家公司的来信（浏览器挑好发来）+ 云端存的简历 → 模型 → 校验过的准备要点。
 * 只在你点「生成」时调用一次；不落库（结果由看板写进这件事的备注）。
 */
export async function prepare(
  env: Env,
  user: User,
  nowMs: number,
  body: unknown,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<PrepareResult> {
  const request = parsePrepRequest(body);
  if (request === null) return { ok: false, status: 400, error: "请求的格式不对" };
  const { LLM_API_KEY: apiKey, LLM_BASE_URL: baseUrl, LLM_MODEL: model } = env;
  if (!apiKey || !baseUrl || !model) return { ok: false, status: 503, error: "还没有配置模型，没法生成" };
  const gate = await takeAiCall(env, user, nowMs);
  if (!gate.ok) return { ok: false, status: 403, error: gate.note.replace("，只用规则解析", "") };
  const resume = await loadResume(env, user.id);
  const complete = openAICompatibleComplete({ baseUrl, apiKey, model, fetchImpl });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      complete({ system: PREP_SYSTEM_PROMPT, user: buildPrepUserPrompt(request, resume?.text ?? null) }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), PREP_TIMEOUT_MS);
      }),
    ]);
    const prep = parsePrepOutput(parseModelJson(reply));
    if (prep === null) return { ok: false, status: 502, error: "AI 这次的回答格式不对，再点一次试试" };
    return { ok: true, prep, usedResume: resume !== null };
  } catch (error) {
    const timeout = error instanceof Error && error.message === "timeout";
    return { ok: false, status: 502, error: timeout ? "AI 太久没回应，稍后再试" : "AI 这次没响应，稍后再试" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
