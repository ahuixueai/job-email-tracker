"use client";

import { useMemo } from "react";
import type { Interview } from "@/types";
import { pickPepTalk } from "@/lib/pepTalk";

interface PepTalkBannerProps {
  interviews: readonly Interview[];
  now: number;
}

/**
 * 每日文案。显隐由 <html data-peptalk> 驱动（CSS 控制），不由 React state 决定——
 * 内联脚本在首帧就设好了属性，所以关掉之后刷新不会先闪一下再消失。
 */
export function PepTalkBanner({ interviews, now }: PepTalkBannerProps) {
  const talk = useMemo(() => pickPepTalk(interviews, now), [interviews, now]);

  return (
    <div className="peptalk-panel mt-5 rounded-card border border-hairline bg-surface px-4 py-3.5">
      <p className="text-xs text-ink-faint">
        {talk.tone === "dense" ? "这几天排得密" : "今天"}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-ink">{talk.text}</p>
    </div>
  );
}
