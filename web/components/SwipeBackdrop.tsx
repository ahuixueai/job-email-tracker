"use client";

import { motion, useTransform, type MotionValue } from "framer-motion";
import { PartyPopper, Archive } from "lucide-react";

interface SwipeBackdropProps {
  /** 卡片当前的水平位移。 */
  x: MotionValue<number>;
  /** 触发阈值（px），用于把「已达标」的视觉状态点亮。 */
  threshold: number;
}

/**
 * 卡片下方的操作提示层：向左露出 Offer，向右露出结束。
 * 透明度跟随位移线性变化，越过阈值后满亮，用户不用猜自己滑没滑够。
 */
export function SwipeBackdrop({ x, threshold }: SwipeBackdropProps) {
  const offerOpacity = useTransform(x, [-threshold, -12, 0], [1, 0.25, 0]);
  const dropOpacity = useTransform(x, [0, 12, threshold], [0, 0.25, 1]);
  const offerScale = useTransform(x, [-threshold, -12], [1, 0.86]);
  const dropScale = useTransform(x, [12, threshold], [0.86, 1]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-between overflow-hidden rounded-card"
    >
      <motion.div
        style={{ opacity: dropOpacity }}
        className="flex h-full flex-1 items-center bg-drop-soft pl-5"
      >
        <motion.span
          style={{ scale: dropScale }}
          className="flex items-center gap-2 text-sm font-medium text-on-drop-soft"
        >
          <Archive size={18} />
          已挂 / 取消
        </motion.span>
      </motion.div>
      <motion.div
        style={{ opacity: offerOpacity }}
        className="flex h-full flex-1 items-center justify-end bg-offer-soft pr-5"
      >
        <motion.span
          style={{ scale: offerScale }}
          className="flex items-center gap-2 text-sm font-medium text-on-offer-soft"
        >
          拿到 Offer
          <PartyPopper size={18} />
        </motion.span>
      </motion.div>
    </div>
  );
}
