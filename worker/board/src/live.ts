import type { EmailRow, LiveData } from "@/lib/demo/liveData";

export { toLiveData } from "@/lib/demo/liveData";
export type { EmailRow, LiveData };

export interface NoticeRow {
  id: string;
  kind: string;
  received_at: string;
  subject: string;
  body: string;
}

/** 看板详情里「模型和规则各管什么」那句。 */
export function extractorNote(models: ReadonlyMap<string, string | null>, ids: readonly string[]): string {
  const used = [...new Set(ids.map((id) => models.get(id)).filter((m): m is string => typeof m === "string"))];
  return used.length > 0
    ? `公司、岗位、时间片段由模型从原文摘出（${used.join("、")}）；是什么事、什么时候、哪个时区由规则判断。`
    : "这封没有用到模型（没配置，或调用失败后退回了纯规则），全部由规则判断。";
}

/** 只提醒最近 7 天内的 Gmail 转发验证码：开通转发是一次性的，过期的不必一直挂着。 */
export const NOTICE_WINDOW_MS = 7 * 86_400_000;

export function forwardingCode(notices: readonly NoticeRow[], nowMs: number): { code: string; receivedAt: string } | null {
  for (const notice of notices) {
    if (notice.kind !== "gmail-forwarding") continue;
    if (nowMs - Date.parse(notice.received_at) > NOTICE_WINDOW_MS) continue;
    const match = /验证码：(\d{6,})/.exec(notice.body);
    if (match?.[1]) return { code: match[1], receivedAt: notice.received_at };
  }
  return null;
}
