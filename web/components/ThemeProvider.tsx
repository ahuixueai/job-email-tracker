"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { PEPTALK_STORAGE_KEY, THEME_STORAGE_KEY } from "@/lib/theme";
import type { ThemeName } from "@/types";

/**
 * 主题的真值存在 <html data-theme> 上——内联脚本在首帧就写好了它，
 * React 只是订阅这个 DOM 属性，而不是另存一份 state。
 *
 * 这样做的好处是不存在「React 认为是浅色、DOM 已经是深色」的窗口期，
 * 也就不会 FOUC；代价是读取要走 MutationObserver。
 */

interface ThemeContextValue {
  /** hydration 完成前为 null（服务端不知道用户选了什么）。 */
  theme: ThemeName | null;
  toggleTheme: () => void;
  setTheme: (next: ThemeName) => void;
  /** 每日文案模块是否开启，hydration 前为 null。 */
  pepTalkOn: boolean | null;
  togglePepTalk: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!observer) {
    observer = new MutationObserver(() => listeners.forEach((l) => l()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-peptalk"],
    });
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

const readTheme = (): ThemeName =>
  document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";

const readPepTalk = (): boolean =>
  document.documentElement.getAttribute("data-peptalk") !== "off";

/** 切换瞬间挂一个类，让颜色过渡，260ms 后摘掉，不常驻拖慢交互。 */
function withTransition(mutate: () => void): void {
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return mutate();
  root.classList.add("theme-switching");
  mutate();
  window.setTimeout(() => root.classList.remove("theme-switching"), 280);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => null);
  const pepTalkOn = useSyncExternalStore(subscribe, readPepTalk, () => null);

  const setTheme = useCallback((next: ThemeName) => {
    withTransition(() => {
      document.documentElement.setAttribute("data-theme", next);
    });
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 隐私模式下 localStorage 会抛，主题仍能在本次会话内切换。
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  const togglePepTalk = useCallback(() => {
    const next = readPepTalk() ? "off" : "on";
    document.documentElement.setAttribute("data-peptalk", next);
    try {
      localStorage.setItem(PEPTALK_STORAGE_KEY, next);
    } catch {
      // 同上：持久化失败不影响本次会话的开关。
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, toggleTheme, setTheme, pepTalkOn, togglePepTalk }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return ctx;
}
