import type { Transition } from "framer-motion";
import type { InterviewStatus, InterviewType } from "@/types";

/** 回弹与吸附统一用 spring 物理动画，不用 tween 缓动。 */
export const SPRING: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
};

/** 卡片吸出屏幕时稍硬一点，避免拖泥带水。 */
export const SPRING_SNAPPY: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
};

/** 命中 prefers-reduced-motion 时，一切过渡退化为瞬时切换。 */
export const INSTANT: Transition = { duration: 0 };

export function springOrInstant(reducedMotion: boolean): Transition {
  return reducedMotion ? INSTANT : SPRING;
}

/** 手势判定阈值。 */
export const GESTURE = {
  /** 判定方向前允许的静默位移（px），太小会误判抖动。 */
  DIRECTION_THRESHOLD: 8,
  /** 触发操作所需的水平位移占卡片宽度比例。 */
  SWIPE_DISTANCE_RATIO: 0.4,
  /** 触发操作所需的水平速度（px/s）。 */
  SWIPE_VELOCITY: 500,
} as const;

export const TYPE_LABEL: Record<InterviewType, string> = {
  video: "视频面试",
  onsite: "现场面试",
  phone: "电话面试",
  assessment: "在线笔试",
  hr: "HR 初面",
};

export const STATUS_LABEL: Record<InterviewStatus, string> = {
  scheduled: "已排期",
  completed: "等结果",
  offer: "已拿 Offer",
  rejected: "已结束",
};
