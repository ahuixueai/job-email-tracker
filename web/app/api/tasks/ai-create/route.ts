import { NextResponse } from "next/server";
import { validateAiCreateTask, type AiCreateTaskInput } from "@/lib/validation";

/**
 * POST /api/tasks/ai-create
 *
 * 供后续「一句话建日程」用的入口。本轮只做结构校验 + mock 响应，
 * 不接任何模型，也不落库。
 *
 * 预期入参 schema：
 * {
 *   "text":        string   必填，1~500 字，用户的自然语言描述
 *   "sourceTimeZone": string 选填，IANA 时区名；缺省时由调用方的本机时区补齐
 *   "subCalendarId": string 选填，归入哪个子日历；缺省进默认日历
 *   "now":         string   选填，UTC ISO 8601，用于解析「明天下午」这类相对表述；
 *                           缺省用服务端当前时间
 * }
 *
 * 成功 200：
 * { "ok": true, "task": { id, text, sourceTimeZone, subCalendarId, receivedAt } }
 *
 * 校验失败 400：
 * { "ok": false, "errors": [{ "field": "text", "message": "..." }] }
 *
 * 手写校验器而不是引入 zod：这里只有四个字段，为它加一个运行时依赖不划算。
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        errors: [{ field: "_body", message: "请求体不是合法的 JSON" }],
      },
      { status: 400 },
    );
  }

  const result = validateAiCreateTask(body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  const input: AiCreateTaskInput = result.value;
  return NextResponse.json({
    ok: true,
    task: {
      id: `task-mock-${Date.now().toString(36)}`,
      text: input.text,
      sourceTimeZone: input.sourceTimeZone ?? null,
      subCalendarId: input.subCalendarId ?? null,
      receivedAt: new Date().toISOString(),
    },
  });
}
