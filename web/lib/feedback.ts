"use client";

/**
 * 反馈降级层：震动与撒花都必须先做特性检测，任何环境下都不允许抛错。
 */

/** iOS Safari 不实现 navigator.vibrate，检测失败就静默降级为纯视觉反馈。 */
export function canVibrate(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
  );
}

/** 震动。不支持时返回 false，由调用方决定是否补视觉反馈。 */
export function vibrate(pattern: number | number[]): boolean {
  if (!canVibrate()) return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

/** 读取系统的「减少动态效果」偏好。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 全屏撒花。命中 prefers-reduced-motion 时直接跳过（不是减量，是完全不放）。
 * canvas-confetti 动态引入，避免进入 SSR 包。
 */
export async function celebrate(reducedMotion: boolean): Promise<void> {
  if (reducedMotion || typeof window === "undefined") return;
  const { default: confetti } = await import("canvas-confetti");
  const base = {
    spread: 70,
    startVelocity: 45,
    ticks: 200,
    zIndex: 60,
    colors: ["#FFC93C", "#7DB8E8", "#1A2634", "#FFFFFF"],
  };
  confetti({ ...base, particleCount: 90, origin: { x: 0.2, y: 0.7 } });
  confetti({ ...base, particleCount: 90, origin: { x: 0.8, y: 0.7 } });
  window.setTimeout(() => {
    confetti({ ...base, particleCount: 60, origin: { x: 0.5, y: 0.5 } });
  }, 140);
}
