import { normalizeTimeZone } from "@/lib/time";

export interface FieldError {
  field: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[] };

export interface AiCreateTaskInput {
  text: string;
  sourceTimeZone?: string;
  subCalendarId?: string;
  now?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 手写校验器：把每个字段的问题都收集齐再一起返回，
 * 而不是遇到第一个错就抛——调用方一次就能把表单填对。
 */
export function validateAiCreateTask(
  body: unknown,
): ValidationResult<AiCreateTaskInput> {
  const errors: FieldError[] = [];
  if (!isRecord(body)) {
    return {
      ok: false,
      errors: [{ field: "_body", message: "请求体必须是 JSON 对象" }],
    };
  }

  const { text, sourceTimeZone, subCalendarId, now } = body;

  if (typeof text !== "string") {
    errors.push({ field: "text", message: "text 必填，且必须是字符串" });
  } else if (text.trim().length === 0) {
    errors.push({ field: "text", message: "text 不能为空" });
  } else if (text.length > 500) {
    errors.push({ field: "text", message: "text 最长 500 字" });
  }

  if (sourceTimeZone !== undefined) {
    if (typeof sourceTimeZone !== "string") {
      errors.push({ field: "sourceTimeZone", message: "sourceTimeZone 必须是字符串" });
    } else if (!normalizeTimeZone(sourceTimeZone)) {
      errors.push({
        field: "sourceTimeZone",
        message: "sourceTimeZone 必须是合法的 IANA 时区名，如 Asia/Shanghai",
      });
    }
  }

  if (subCalendarId !== undefined) {
    if (typeof subCalendarId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(subCalendarId)) {
      errors.push({
        field: "subCalendarId",
        message: "subCalendarId 必须是 1~64 位的字母、数字、下划线或连字符",
      });
    }
  }

  if (now !== undefined) {
    if (typeof now !== "string" || Number.isNaN(Date.parse(now))) {
      errors.push({ field: "now", message: "now 必须是 UTC ISO 8601 字符串" });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      text: (text as string).trim(),
      sourceTimeZone: sourceTimeZone as string | undefined,
      subCalendarId: subCalendarId as string | undefined,
      now: now as string | undefined,
    },
  };
}

/** 允许出现在 <a href> 里的协议。只有这两个，不留扩展口子。 */
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * 把一个来路不明的值收成可以安全塞进 href 的 URL，收不了就返回 null。
 *
 * 会走到这里的值有三个来源：用户手填的表单、导入的备份文件、Google 日历事件正文。
 * 后两个都不是用户当场输入的，`javascript:` / `data:` 塞进来完全可能。
 *
 * 用 new URL 解析而不是正则匹配前缀：`java\tscript:` 这类靠控制字符绕过前缀检查的写法，
 * 浏览器会当成 javascript: 执行，正则却看不出来。让 URL 解析器和浏览器用同一套规则。
 */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? trimmed : null;
  } catch {
    // 相对地址、纯文本都会走到这里。面试链接必须是完整地址，不做补全。
    return null;
  }
}
