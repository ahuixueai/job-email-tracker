import type { IanaTimeZone } from "@/types";
import { normalizeTimeZone } from "@/lib/time";

/**
 * 需要在 SSR 阶段就知道的偏好走 cookie，只影响客户端行为的走 localStorage。
 * 判据是「首帧渲染结果是否依赖它」：依赖就必须让服务端读得到，否则一定闪。
 */
export const TIME_ZONE_COOKIE = "jcc_tz";

/** 一年。这些偏好都不是高频变动的东西，过期太快等于每次都首访。 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return raw ? decodeURIComponent(raw) : null;
}

export function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  if (readCookie(name) === value) return; // 已一致就别反复写
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax${secure}`;
}

/** 校验时区 cookie，非法值一律降级为 null（等同首次访问）。 */
export function parseTimeZoneCookie(
  value: string | undefined,
): IanaTimeZone | null {
  return normalizeTimeZone(value);
}
