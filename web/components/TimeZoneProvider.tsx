"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { getLocalTimeZone } from "@/lib/time";
import { TIME_ZONE_COOKIE, writeCookie } from "@/lib/prefs";
import type { IanaTimeZone } from "@/types";

/**
 * 本机时区的来源，按可靠度排列：
 * 1. cookie（服务端在 SSR 阶段就读到了）→ 首屏直接渲染正确的双列布局，无抖动
 * 2. hydration 后的 Intl 检测 → 首次访问、或用户换了时区时纠正并回写 cookie
 * 3. null → 尚不知道，双时区退化成单列（首次访问的降级形态）
 */
const ViewerTimeZoneContext = createContext<IanaTimeZone | null>(null);

const noopSubscribe = (): (() => void) => () => {};

interface TimeZoneProviderProps {
  /** 服务端从 cookie 读到的时区；首次访问为 null。 */
  initialTimeZone: IanaTimeZone | null;
  children: React.ReactNode;
}

export function TimeZoneProvider({
  initialTimeZone,
  children,
}: TimeZoneProviderProps) {
  /**
   * hydration 期间 React 用 getServerSnapshot（= cookie 值），与服务端输出一致；
   * 之后才切到真实检测值。用 useSyncExternalStore 而不是 useEffect + setState，
   * 免掉 effect 内同步 setState 引发的级联渲染。
   */
  const zone = useSyncExternalStore(
    noopSubscribe,
    getLocalTimeZone,
    () => initialTimeZone,
  );

  useEffect(() => {
    if (zone) writeCookie(TIME_ZONE_COOKIE, zone);
  }, [zone]);

  return (
    <ViewerTimeZoneContext.Provider value={zone}>
      {children}
    </ViewerTimeZoneContext.Provider>
  );
}

/** 当前已知的本机时区；尚未确定时为 null。 */
export function useViewerTimeZone(): IanaTimeZone | null {
  return useContext(ViewerTimeZoneContext);
}
