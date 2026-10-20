import { createContext, useContext } from "react";

/**
 * 登录的是谁、他的收信地址、允许哪些邮箱转信进来、AI 开关与今天的用量。
 * 来自 /api/session；App 登录后读一次，改了转发邮箱或 AI 开关后再读一次。
 */
export interface SessionData {
  email: string;
  role: "owner" | "member";
  /** 这个人的收信地址（作者是 jobs@，其他人是 u-口令@）。 */
  inbox: string;
  /** 只收这些邮箱转来的信（登录邮箱 + 自己加的）。 */
  forwarders: string[];
  /** 自己加的（不含登录邮箱）。 */
  extraForwarders: string[];
  maxExtraForwarders: number;
  ai: { enabled: boolean; usedToday: number; dailyLimit: number | null };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

export function parseSession(body: unknown): SessionData | null {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const user = (b.user ?? {}) as { email?: unknown; role?: unknown };
  const ai = (b.ai ?? {}) as { enabled?: unknown; usedToday?: unknown; dailyLimit?: unknown };
  if (typeof user.email !== "string" || typeof b.inbox !== "string") return null;
  return {
    email: user.email,
    role: user.role === "owner" ? "owner" : "member",
    inbox: b.inbox,
    forwarders: strings(b.forwarders),
    extraForwarders: strings(b.extraForwarders),
    maxExtraForwarders: typeof b.maxExtraForwarders === "number" ? b.maxExtraForwarders : 0,
    ai: {
      enabled: ai.enabled !== false,
      usedToday: typeof ai.usedToday === "number" ? ai.usedToday : 0,
      dailyLimit: typeof ai.dailyLimit === "number" ? ai.dailyLimit : null,
    },
  };
}

export const SessionContext = createContext<{ session: SessionData; reload: () => Promise<void> } | null>(null);

export function useSession(): { session: SessionData; reload: () => Promise<void> } {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession 要在登录之后用");
  return value;
}

/** 转发人的一句话：「a、b」；没有时给个兜底说法。 */
export function senderText(forwarders: readonly string[]): string {
  return forwarders.length > 0 ? forwarders.join("、") : "你的邮箱";
}
