"use client";

import { useSyncExternalStore } from "react";
import { ssrSafeAnchor } from "@/lib/time";

/**
 * 会走动的「现在」。
 *
 * 用 useSyncExternalStore 而不是 useEffect + setState：
 * hydration 阶段 React 会调用 getServerSnapshot（返回 SSR 锚点），
 * 与服务端渲染结果必然一致；hydration 完成后才切到真实时间。
 * 既没有 hydration mismatch，也不用在 effect 里同步 setState。
 */
const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let timer: number | null = null;
let snapshot = 0;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === null) {
    snapshot = Date.now();
    timer = window.setInterval(() => {
      snapshot = Date.now();
      listeners.forEach((listener) => listener());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  if (snapshot === 0) snapshot = Date.now();
  return snapshot;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, ssrSafeAnchor);
}
