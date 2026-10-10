"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { SPRING } from "@/lib/motion";
import type { FunnelData } from "@/lib/funnel";

interface Payload {
  ok: boolean;
  funnel?: FunnelData;
  error?: string;
  hint?: string;
}

/**
 * 漏斗面板。刻意只有一个漏斗 + 一行中位数占位，没有别的。
 *
 * 不做图表堆砌、筛选器、导出、时间范围选择器——
 * 阶段 A 只有作者一个人用，多加一样就是在给还不存在的用户造仪表盘。
 */
export function FunnelPanel({
  reducedMotion,
  onClose,
}: {
  reducedMotion: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/funnel")
      .then((r) => r.json())
      .then((j: Payload) => alive && setData(j))
      .catch((e: Error) => alive && setData({ ok: false, error: e.message }));
    return () => {
      alive = false;
    };
  }, []);

  const f = data?.funnel;

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
      transition={SPRING}
      className="mt-3 rounded-xl border border-hairline bg-surface p-4"
      data-funnel-panel
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">求职漏斗</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            每一级是「到过这一级的累计条数」，不是「现在停在这一级」
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭漏斗"
          className="rounded-lg p-1 text-ink-soft hover:bg-raised"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      {!data ? (
        <p className="mt-4 text-sm text-ink-faint">读取台账中…</p>
      ) : !f ? (
        <div className="mt-4">
          <p className="text-sm text-on-drop-soft">读不到台账：{data.error}</p>
          {data.hint ? (
            <p className="mt-1 text-xs text-ink-faint">{data.hint}</p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            {/*
              线索池（found / closed）不在这里显示：它属于 jd-scout 的岗位搜集，
              不在本产品边界内。漏斗从「投递」起。
            */}
            {f.stages.map((s, i) => (
              <div key={s.key} className="flex items-center gap-3">
                {i > 0 ? (
                  <span aria-hidden className="text-ink-faint">
                    →
                  </span>
                ) : null}
                <div className="rounded-lg bg-brand-soft px-3 py-2">
                  <div className="text-lg font-semibold tabular-nums text-ink">
                    {s.count}
                  </div>
                  <div className="text-xs text-on-brand-soft">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {f.appliedExact < f.stages[0].count ? (
            <p className="mt-3 text-xs text-ink-faint">
              投递 {f.stages[0].count} 条里只有 {f.appliedExact}{" "}
              条有确切投递日期，其余是按状态推断的（没投过不会收到测评邀请）。
              往后用 <code className="text-ink-soft">scripts/mark_applied.py</code>{" "}
              标记，新投的就有真值。
            </p>
          ) : null}

          <div className="mt-4 border-t border-hairline pt-3">
            <div className="text-xs text-ink-soft">每级停留中位数</div>
            {f.medians ? (
              <div className="mt-1 text-sm tabular-nums text-ink">
                投递→测评 {f.medians.appliedToOa} 天 · 测评→面试{" "}
                {f.medians.oaToInterview} 天
              </div>
            ) : (
              // 不显示 0 天，也不显示任何占位数字：编一个数比留空危害大
              <div className="mt-1 text-sm text-ink-faint">
                样本不足，等更多数据
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
