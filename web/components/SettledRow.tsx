"use client";

import { Archive } from "lucide-react";
import type { Interview } from "@/types";

/**
 * 已挂 / 取消后的折叠形态：只留一行。
 * 高度变化由外层 Reorder.Item 的 layout 动画负责过渡。
 */
export function SettledRow({ interview }: { interview: Interview }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
      <Archive size={15} className="shrink-0 text-ink-faint" aria-hidden />
      <span className="truncate text-sm font-medium text-ink-soft">
        {interview.company}
      </span>
      <span className="truncate text-xs text-ink-faint">
        {interview.position}
      </span>
      <span className="ml-auto shrink-0 text-xs text-ink-faint">已结束</span>
    </div>
  );
}
