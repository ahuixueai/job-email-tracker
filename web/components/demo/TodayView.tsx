"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { CardGrid, OverdueSection } from "@/components/demo/AgendaView";
import type { AgendaActions } from "@/components/demo/AgendaView";
import { phaseOf } from "@/lib/demo/agenda";
import type { AgendaItem } from "@/lib/demo/agenda";
import type { ApplicationRow } from "@/lib/demo/applications";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 「还有 2 小时 15 分」「还有 3 天」「已经开始 20 分钟」。 */
export function countdown(atMs: number, nowMs: number): string {
  const diff = atMs - nowMs;
  if (diff < 0) {
    const minutes = Math.round(-diff / 60_000);
    return minutes < 60 ? `已经开始 ${minutes} 分钟` : `已经开始 ${Math.floor(minutes / 60)} 小时`;
  }
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `还有 ${minutes} 分钟`;
  if (diff < DAY) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `还有 ${h} 小时` : `还有 ${h} 小时 ${m} 分`;
  }
  const days = Math.floor(diff / DAY);
  const hours = Math.round((diff - days * DAY) / HOUR);
  // 三天以内多给一级精度：「还有 1 天」可能是 25 小时也可能是 47 小时
  if (days < 3 && hours > 0 && hours < 24) return `还有 ${days} 天 ${hours} 小时`;
  return `还有 ${Math.round(diff / DAY)} 天`;
}

/**
 * 「今天」：打开看板第一眼要知道的三件事——
 * 下一件事是什么、还剩多久；48 小时内还有什么；有没有要你处理的（做了吗、该跟进、待确认）。
 */
export function TodayView({
  items,
  applications,
  nowMs: initialNowMs,
  viewerTimeZone,
  actions,
  warning = null,
  onGo,
}: {
  items: readonly AgendaItem[];
  applications: readonly ApplicationRow[];
  nowMs: number;
  viewerTimeZone: string;
  actions: AgendaActions;
  /** 收信可能出问题时的一句提醒（私人看板才有）。 */
  warning?: string | null;
  /** 跳到别的视图（投递表可以带上「该跟进了」筛选）。 */
  onGo: (view: "agenda" | "pending" | "applications" | "settings", filter?: "followup") => void;
}) {
  // 倒计时每分钟走一次；阶段划分仍按看板打开时的「现在」，避免卡片在你眼前跳来跳去
  const [nowMs, setNowMs] = useState(initialNowMs);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const board = items.filter((item) => item.place === "board");
  const active = board.filter((item) => phaseOf(item, initialNowMs) === "active");
  const overdue = board.filter((item) => phaseOf(item, initialNowMs) === "overdue");
  const timed = active
    .filter((item) => item.result.when !== null)
    .sort((a, b) => Date.parse(a.result.when?.utc ?? "") - Date.parse(b.result.when?.utc ?? ""));
  const next = timed[0] ?? null;
  const soon = timed.slice(1).filter((item) => Date.parse(item.result.when?.utc ?? "") <= nowMs + 2 * DAY);
  const thisWeek = timed.filter((item) => Date.parse(item.result.when?.utc ?? "") <= nowMs + 7 * DAY).length;
  const undated = active.length - timed.length;
  const followUps = applications.filter((row) => row.followUpDue).length;
  const pending = items.filter((item) => item.place === "pending").length;

  const today = new Date(nowMs).toLocaleDateString("zh-CN", { timeZone: viewerTimeZone, month: "long", day: "numeric", weekday: "short" });

  return (
    <div className="space-y-7">
      <p className="text-sm text-ink-soft">{today}</p>

      {warning ? (
        <p role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent-soft px-4 py-3 text-sm text-ink" data-health-warning>
          {warning}
          <button type="button" onClick={() => onGo("settings")} className="text-xs font-semibold underline underline-offset-2">
            去「设置」看看
          </button>
        </p>
      ) : null}

      <section aria-label="下一件事" data-today="next">
        <h2 className="text-sm font-semibold text-ink">下一件事</h2>
        {next ? (
          <>
            <p className="tabular mt-1 text-2xl font-semibold text-ink" data-countdown>
              {countdown(Date.parse(next.result.when?.utc ?? ""), nowMs)}
            </p>
            <CardGrid items={[next]} viewerTimeZone={viewerTimeZone} actions={actions} />
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-faint">接下来没有带具体时间的安排。</p>
        )}
      </section>

      {soon.length > 0 ? (
        <section aria-label="48 小时内" data-today="soon">
          <h2 className="text-sm font-semibold text-ink">
            48 小时内还有
            <span className="tabular ml-2 text-xs font-normal text-ink-faint">{soon.length}</span>
          </h2>
          <CardGrid items={soon} viewerTimeZone={viewerTimeZone} actions={actions} />
        </section>
      ) : null}

      <OverdueSection items={overdue} viewerTimeZone={viewerTimeZone} actions={actions} />

      <section aria-label="要你处理的" data-today="todo">
        <h2 className="text-sm font-semibold text-ink">要你处理的</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="7 天内的安排" value={thisWeek} hint={undated > 0 ? `另有 ${undated} 件没写具体时间` : "全部在日程里"} onClick={() => onGo("agenda")} action="go-agenda" />
          <Tile label="该跟进了" value={followUps} hint="跟进日期已到的投递" onClick={() => onGo("applications", "followup")} action="go-followup" />
          <Tile label="等你确认" value={pending} hint="系统拿不准、没替你排的事" onClick={() => onGo("pending")} action="go-pending" />
          <Tile label="做了吗？" value={overdue.length} hint="时间已过、还没标完成" onClick={() => onGo("agenda")} action="go-overdue" />
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value, hint, onClick, action }: { label: string; value: number; hint: string; onClick: () => void; action: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-action={action}
      className="group flex flex-col items-start rounded-xl border border-hairline bg-surface p-4 text-left hover:bg-raised"
    >
      <span className="text-xs text-ink-soft">{label}</span>
      <span className="tabular mt-1 text-2xl font-semibold text-ink">{value}</span>
      <span className="mt-1 flex w-full items-center justify-between gap-2 text-xs text-ink-faint">
        {hint}
        <ArrowRight size={13} aria-hidden className="shrink-0 opacity-60 group-hover:opacity-100" />
      </span>
    </button>
  );
}
