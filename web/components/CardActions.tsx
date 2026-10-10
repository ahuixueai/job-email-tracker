"use client";

import { motion } from "framer-motion";
import { ChevronUp, ChevronDown, GripVertical, PartyPopper, Archive, Undo2, Pencil } from "lucide-react";
import { SPRING } from "@/lib/motion";
import type { InterviewStatus } from "@/types";

interface CardActionsProps {
  company: string;
  status: InterviewStatus;
  reducedMotion: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  onOffer: () => void;
  onReject: () => void;
  onRestore: () => void;
  onEdit: () => void;
  onGripPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}

/**
 * 手势之外的第二条路：所有操作都有可见、可 Tab 聚焦的按钮。
 * 把手（GripVertical）单独设 touch-action: none，触屏上用它排序，
 * 卡片主体保留 pan-y 让页面照常滚动。
 */
export function CardActions(props: CardActionsProps) {
  const { status, reducedMotion, company } = props;
  const settled = status === "offer" || status === "rejected";
  const tap = reducedMotion ? undefined : { scale: 0.96 };

  return (
    <div className="flex items-center gap-1 border-t border-hairline px-3 py-2">
      <button
        type="button"
        aria-label={`拖拽把手：${company}，或用 Alt + 上下方向键调整顺序`}
        title="按住拖动，上下调整顺序"
        onPointerDown={props.onGripPointerDown}
        className="cursor-grab rounded-lg p-1.5 text-ink-faint hover:bg-raised active:cursor-grabbing"
        style={{ touchAction: "none" }}
      >
        <GripVertical size={16} aria-hidden />
      </button>
      <IconButton
        label={`上移 ${company}`}
        title="上移一位（Alt + ↑）"
        disabled={!props.canMoveUp}
        onClick={() => props.onMove(-1)}
        tap={tap}
      >
        <ChevronUp size={16} aria-hidden />
      </IconButton>
      <IconButton
        label={`下移 ${company}`}
        title="下移一位（Alt + ↓）"
        disabled={!props.canMoveDown}
        onClick={() => props.onMove(1)}
        tap={tap}
      >
        <ChevronDown size={16} aria-hidden />
      </IconButton>

      <IconButton
        label={`编辑 ${company}`}
        title="编辑这场面试"
        disabled={false}
        onClick={props.onEdit}
        tap={tap}
      >
        <Pencil size={15} aria-hidden />
      </IconButton>

      <div className="ml-auto flex items-center gap-1.5">
        {settled ? (
          <motion.button
            type="button"
            whileTap={tap}
            transition={SPRING}
            onClick={props.onRestore}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-raised"
          >
            <Undo2 size={14} aria-hidden />
            撤销
          </motion.button>
        ) : (
          <>
            <motion.button
              type="button"
              whileTap={tap}
              transition={SPRING}
              onClick={props.onReject}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-drop-soft"
            >
              <Archive size={14} aria-hidden />
              已挂
            </motion.button>
            <motion.button
              type="button"
              whileTap={tap}
              transition={SPRING}
              onClick={props.onOffer}
              className="flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand-soft px-3 py-1.5 text-xs font-semibold text-ink hover:bg-raised"
            >
              <PartyPopper size={14} aria-hidden />
              拿到 Offer
            </motion.button>
          </>
        )}
      </div>
    </div>
  );
}

interface IconButtonProps {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  tap: { scale: number } | undefined;
  children: React.ReactNode;
}

function IconButton({
  label,
  title,
  disabled,
  onClick,
  tap,
  children,
}: IconButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      whileTap={disabled ? undefined : tap}
      transition={SPRING}
      onClick={onClick}
      className="rounded-lg p-1.5 text-ink-faint hover:bg-raised disabled:opacity-30"
    >
      {children}
    </motion.button>
  );
}
