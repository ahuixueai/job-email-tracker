"use client";

import { motion } from "framer-motion";
import { Video, FileText, NotebookPen, ChevronUp, Timer } from "lucide-react";
import type { PrepInfo } from "@/types";
import { SPRING } from "@/lib/motion";

interface PrepCapsuleProps {
  prep: PrepInfo;
  /** 距开始还有多少分钟，负数表示已经开始。 */
  minutesUntilStart: number;
  reducedMotion: boolean;
  onCollapse: () => void;
  onOpenNotes: () => void;
}

/**
 * 一键备战胶囊：距开始 ≤ 60 分钟时自动展开。
 * 三个行动点的数据都来自 PrepInfo，缺哪个就把哪个按钮置灰并写明原因，
 * 不做「点了没反应」的假按钮。
 */
export function PrepCapsule({
  prep,
  minutesUntilStart,
  reducedMotion,
  onCollapse,
  onOpenNotes,
}: PrepCapsuleProps) {
  const tap = reducedMotion ? undefined : { scale: 0.96 };
  const countdown =
    minutesUntilStart < 0
      ? "已经开始了"
      : minutesUntilStart < 1
        ? "不到 1 分钟后开始"
        : `${minutesUntilStart} 分钟后开始`;

  return (
    <div className="border-t border-hairline bg-brand-soft px-4 py-3 sm:px-5">
      <div className="flex items-center gap-2">
        <Timer size={14} className="shrink-0 text-on-brand-soft" aria-hidden />
        <span className="text-xs font-medium text-on-brand-soft">
          {countdown}。东西都在这儿了。
        </span>
        <motion.button
          type="button"
          whileTap={tap}
          transition={SPRING}
          onClick={onCollapse}
          title="收起备战面板（5 分钟内不会再自动展开）"
          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-on-brand-soft hover:bg-surface"
        >
          <ChevronUp size={14} aria-hidden />
          收起
        </motion.button>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <PrepAction
          icon={<Video size={15} aria-hidden />}
          label="进入会议"
          href={prep.meetingUrl}
          missingReason="这场没有会议链接"
          tap={tap}
        />
        <PrepAction
          icon={<FileText size={15} aria-hidden />}
          label="预览简历"
          href={prep.resumeUrl}
          missingReason="还没挂简历 PDF"
          tap={tap}
        />
        <PrepAction
          icon={<NotebookPen size={15} aria-hidden />}
          label="JD 笔记"
          onClick={prep.jdNotes ? onOpenNotes : undefined}
          missingReason="这个岗位还没记笔记"
          tap={tap}
        />
      </div>
    </div>
  );
}

interface PrepActionProps {
  icon: React.ReactNode;
  label: string;
  href?: string | null;
  onClick?: () => void;
  missingReason: string;
  tap: { scale: number } | undefined;
}

function PrepAction({
  icon,
  label,
  href,
  onClick,
  missingReason,
  tap,
}: PrepActionProps) {
  const available = Boolean(href) || Boolean(onClick);
  const className =
    "flex w-full items-center justify-center gap-1.5 rounded-xl border border-hairline bg-surface px-2 py-2 text-xs font-medium text-ink";

  if (!available) {
    return (
      <span
        title={missingReason}
        aria-disabled
        className={`${className} cursor-not-allowed opacity-45`}
      >
        {icon}
        {label}
      </span>
    );
  }

  if (href) {
    return (
      <motion.a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        whileTap={tap}
        transition={SPRING}
        className={className}
      >
        {icon}
        {label}
      </motion.a>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={tap}
      transition={SPRING}
      className={className}
    >
      {icon}
      {label}
    </motion.button>
  );
}
