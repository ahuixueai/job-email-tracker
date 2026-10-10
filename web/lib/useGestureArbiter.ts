"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDragControls } from "framer-motion";
import { GESTURE } from "@/lib/motion";
import type { GestureLock } from "@/types";

/**
 * 手势仲裁器：一次指针交互只能是「水平滑动」或「垂直排序」中的一种。
 *
 * 做法是把两套 framer 拖拽都设成 dragListener={false}，谁都不自己监听指针，
 * 全部由这里裁决：指针首次移动超过 8px 时比较 |dx| 与 |dy|，
 * 谁大就 start 谁，锁定后本次手势中途不再改判，直到 pointerup / pointercancel。
 *
 * 这样两种手势物理上不可能同时激活，也就不存在串扰。
 */
export interface GestureArbiter {
  /** 挂在 Reorder.Item 上的 dragControls。 */
  reorderControls: ReturnType<typeof useDragControls>;
  /** 挂在 drag="x" 层上的 dragControls。 */
  swipeControls: ReturnType<typeof useDragControls>;
  /** 当前锁定结果，供 UI 做视觉反馈（如拖拽中抬起阴影）。 */
  lock: GestureLock;
  /** 挂在卡片上的 onPointerDown。 */
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** 拖拽把手用：跳过仲裁，直接进入排序。 */
  startReorder: (event: React.PointerEvent<HTMLElement>) => void;
}

export function useGestureArbiter(enabled: boolean): GestureArbiter {
  const reorderControls = useDragControls();
  const swipeControls = useDragControls();
  const [lock, setLock] = useState<GestureLock>("none");

  const originRef = useRef<{ x: number; y: number } | null>(null);
  const lockRef = useRef<GestureLock>("none");
  const cleanupRef = useRef<(() => void) | null>(null);

  const release = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    originRef.current = null;
    lockRef.current = "none";
    setLock("none");
  }, []);

  // 组件卸载时务必摘掉 window 上的监听，避免手势中途卡片被移除后泄漏。
  useEffect(() => release, [release]);

  const startReorder = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      lockRef.current = "reorder";
      setLock("reorder");
      reorderControls.start(event);
      const end = () => release();
      window.addEventListener("pointerup", end, { once: true });
      window.addEventListener("pointercancel", end, { once: true });
      cleanupRef.current = () => {
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };
    },
    [enabled, reorderControls, release],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      // 只响应主键，避免右键菜单和中键粘贴触发拖拽。
      if (event.pointerType === "mouse" && event.button !== 0) return;

      originRef.current = { x: event.clientX, y: event.clientY };
      lockRef.current = "none";

      const onMove = (moveEvent: PointerEvent) => {
        const origin = originRef.current;
        if (!origin || lockRef.current !== "none") return;
        const dx = Math.abs(moveEvent.clientX - origin.x);
        const dy = Math.abs(moveEvent.clientY - origin.y);
        if (Math.max(dx, dy) < GESTURE.DIRECTION_THRESHOLD) return;

        // 唯一的判定点：此后本次手势不再改判。
        if (dx > dy) {
          lockRef.current = "swipe";
          setLock("swipe");
          swipeControls.start(moveEvent);
        } else {
          lockRef.current = "reorder";
          setLock("reorder");
          reorderControls.start(moveEvent);
        }
      };

      const onEnd = () => release();

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };
    },
    [enabled, release, reorderControls, swipeControls],
  );

  return { reorderControls, swipeControls, lock, onPointerDown, startReorder };
}
