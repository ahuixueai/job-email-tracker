"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Reorder,
  animate,
  motion,
  useMotionValue,
  type PanInfo,
} from "framer-motion";
import type { Interview, SubCalendar, SwipeAction } from "@/types";
import { GESTURE, INSTANT, SPRING, springOrInstant } from "@/lib/motion";
import { celebrate, vibrate } from "@/lib/feedback";
import { useGestureArbiter } from "@/lib/useGestureArbiter";
import { CardActions } from "@/components/CardActions";
import { CardContent } from "@/components/CardContent";
import { SwipeBackdrop } from "@/components/SwipeBackdrop";

interface InterviewCardProps {
  interview: Interview;
  subCalendar: SubCalendar | undefined;
  score: number;
  now: number;
  index: number;
  total: number;
  reducedMotion: boolean;
  onMove: (id: string, delta: -1 | 1) => void;
  onAction: (id: string, action: SwipeAction) => void;
  onRestore: (id: string) => void;
  /** 备战胶囊是否应当展开（时间窗内且未被折叠）。 */
  prepOpen: boolean;
  minutesUntilStart: number;
  onCollapsePrep: (id: string) => void;
  onEdit: (id: string) => void;
  onEnterFocus: (id: string, trigger: HTMLElement) => void;
}

export function InterviewCard(props: InterviewCardProps) {
  const { interview, reducedMotion, index, total } = props;
  const cardRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const arbiter = useGestureArbiter(true);
  // 阈值随卡片宽度走，提示层的点亮时机才和真实触发点一致。
  const [cardWidth, setCardWidth] = useState(360);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) setCardWidth(rect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const swipeThreshold = cardWidth * GESTURE.SWIPE_DISTANCE_RATIO;

  const rejected = interview.status === "rejected";
  const settled = rejected || interview.status === "offer";
  const transition = springOrInstant(reducedMotion);

  const commit = useCallback(
    (action: SwipeAction) => {
      if (action === "offer") {
        // 震动失败（iOS Safari 没有 vibrate）不影响撒花，纯视觉反馈照常。
        vibrate([12, 40, 18]);
        void celebrate(reducedMotion);
      } else {
        vibrate(18);
      }
      props.onAction(interview.id, action);
    },
    [interview.id, props, reducedMotion],
  );

  const settleBack = useCallback(() => {
    if (reducedMotion) x.set(0);
    else animate(x, 0, SPRING);
  }, [reducedMotion, x]);

  const handleDragEnd = useCallback(
    (_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
      const distance =
        (cardRef.current?.offsetWidth ?? cardWidth) *
        GESTURE.SWIPE_DISTANCE_RATIO;
      const { offset, velocity } = info;
      const flungLeft =
        offset.x < -distance ||
        (velocity.x < -GESTURE.SWIPE_VELOCITY && offset.x < -24);
      const flungRight =
        offset.x > distance ||
        (velocity.x > GESTURE.SWIPE_VELOCITY && offset.x > 24);

      // 未达阈值：spring 回弹归位，什么都不做。
      if (!flungLeft && !flungRight) return settleBack();
      commit(flungLeft ? "offer" : "rejected");
      settleBack();
    },
    [cardWidth, commit, settleBack],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLLIElement>) => {
      // 排序的键盘替代路径。加 Alt 是为了不抢走方向键的页面滚动。
      if (!event.altKey) return;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        props.onMove(interview.id, -1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        props.onMove(interview.id, 1);
      }
    },
    [interview.id, props],
  );

  return (
    <Reorder.Item
      value={interview}
      drag="y"
      dragListener={false}
      dragControls={arbiter.reorderControls}
      dragElastic={0.06}
      layout
      transition={transition}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label={`${interview.company} ${interview.position}，优先级得分 ${props.score}，第 ${index + 1} 项，共 ${total} 项`}
      className="relative list-none rounded-card outline-none"
      style={{ position: "relative" }}
      whileDrag={reducedMotion ? undefined : { scale: 1.02, zIndex: 20 }}
    >
      <div className="relative overflow-hidden rounded-card">
        <SwipeBackdrop x={x} threshold={swipeThreshold} />
        <motion.div
          ref={cardRef}
          drag={settled ? false : "x"}
          dragDirectionLock
          dragListener={false}
          dragControls={arbiter.swipeControls}
          dragElastic={0.16}
          dragMomentum={false}
          onDragEnd={handleDragEnd}
          onPointerDown={settled ? undefined : arbiter.onPointerDown}
          style={{ x, touchAction: "pan-y" }}
          animate={{
            filter: rejected ? "grayscale(1)" : "grayscale(0)",
            opacity: rejected ? 0.62 : 1,
          }}
          transition={reducedMotion ? INSTANT : { duration: 0.28 }}
          className={`relative rounded-card bg-surface ${
            arbiter.lock === "reorder" ? "shadow-lifted" : "shadow-card"
          }`}
        >
          <CardContent
            interview={interview}
            subCalendar={props.subCalendar}
            score={props.score}
            now={props.now}
            reducedMotion={reducedMotion}
            prepOpen={props.prepOpen}
            minutesUntilStart={props.minutesUntilStart}
            onCollapsePrep={() => props.onCollapsePrep(interview.id)}
            onEnterFocus={(trigger) => props.onEnterFocus(interview.id, trigger)}
          />
          <CardActions
            company={interview.company}
            status={interview.status}
            reducedMotion={reducedMotion}
            canMoveUp={index > 0}
            canMoveDown={index < total - 1}
            onMove={(delta) => props.onMove(interview.id, delta)}
            onOffer={() => commit("offer")}
            onReject={() => commit("rejected")}
            onRestore={() => props.onRestore(interview.id)}
            onEdit={() => props.onEdit(interview.id)}
            onGripPointerDown={arbiter.startReorder}
          />
        </motion.div>
      </div>
    </Reorder.Item>
  );
}
