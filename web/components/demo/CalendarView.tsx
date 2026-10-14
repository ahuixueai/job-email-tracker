"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AddButton, CompleteButton, RemoveButton } from "@/components/demo/AgendaView";
import type { AgendaActions } from "@/components/demo/AgendaView";
import { ActionButton, EventCard } from "@/components/demo/EventCard";
import { buildMonth, dateKeyIn, groupByDate, shiftMonth } from "@/lib/demo/agenda";
import type { AgendaItem } from "@/lib/demo/agenda";
import { zoneLabel } from "@/lib/demo/parseDemo";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * 「日历」视图：月历 + 选中那天的日程卡。
 * 格子按**你所在时区**的日期落位——同一场考试在北京是周四晚上，在纽约是周四早上，
 * 跨日的时候甚至不是同一天，日历得按看的人算。
 */
export function CalendarView({
  items,
  viewerTimeZone,
  nowMs,
  actions,
}: {
  items: readonly AgendaItem[];
  viewerTimeZone: string;
  nowMs: number;
  actions: AgendaActions;
}) {
  const todayKey = dateKeyIn(nowMs, viewerTimeZone);
  const byDate = groupByDate(items, viewerTimeZone);
  const firstBusy = [...byDate.keys()].sort()[0] ?? todayKey;

  const [cursor, setCursor] = useState(() => ({
    year: Number(todayKey.slice(0, 4)),
    month: Number(todayKey.slice(5, 7)),
  }));
  const [selected, setSelected] = useState(firstBusy);
  const grid = buildMonth(cursor.year, cursor.month);
  const selectedItems = byDate.get(selected) ?? [];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 rounded-xl border border-hairline bg-surface p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <h3 className="tabular text-sm font-semibold text-ink">
            {cursor.year} 年 {cursor.month} 月
          </h3>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="上个月"
              onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, -1))}
              className="rounded-lg p-1.5 text-ink-soft hover:bg-raised"
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="下个月"
              onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, 1))}
              className="rounded-lg p-1.5 text-ink-soft hover:bg-raised"
            >
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-ink-faint">
          {WEEKDAYS.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {grid.weeks.flat().map((day) => {
            const events = byDate.get(day.dateKey) ?? [];
            const isSelected = day.dateKey === selected;
            return (
              <button
                key={day.dateKey}
                type="button"
                onClick={() => setSelected(day.dateKey)}
                aria-pressed={isSelected}
                aria-label={`${day.dateKey}，${events.length} 项安排`}
                data-date={day.dateKey}
                className={`flex min-h-16 min-w-0 flex-col items-stretch rounded-lg border p-1 text-left ${
                  isSelected ? "border-brand-line bg-brand-soft" : "border-hairline hover:bg-raised"
                }`}
              >
                <span
                  className={`tabular text-xs ${
                    day.dateKey === todayKey
                      ? "font-semibold text-ink"
                      : day.inMonth
                        ? "text-ink-soft"
                        : "text-ink-faint"
                  }`}
                >
                  {day.day}
                  {day.dateKey === todayKey ? <span className="hidden sm:inline"> 今天</span> : null}
                </span>
                {/* 宽屏写出是什么事；手机上格子只有四十多像素宽，写字会被截成「在…」，改用色条 */}
                {events.slice(0, 2).map((item) => (
                  <span
                    key={item.key}
                    className={`mt-1 block h-1.5 rounded-full sm:mt-0.5 sm:h-auto sm:truncate sm:rounded sm:px-1 sm:text-[11px] sm:leading-5 ${
                      item.completion !== null
                        ? "bg-hairline text-ink-faint sm:line-through"
                        : item.result.dueType === "fixed_start"
                          ? "bg-accent text-on-accent"
                          : "bg-offer-soft text-on-offer-soft"
                    }`}
                  >
                    <span className="hidden sm:inline">
                      {item.completion?.state === "done" ? "✓ " : ""}
                      {item.result.kindLabel}
                    </span>
                  </span>
                ))}
                {events.length > 2 ? (
                  <span className="mt-0.5 hidden text-[11px] text-ink-faint sm:block">
                    还有 {events.length - 2} 项
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span className="rounded bg-accent px-1.5 text-on-accent">准点开始</span>
          <span className="rounded bg-offer-soft px-1.5 text-on-offer-soft">截止前完成</span>
          <span className="rounded bg-hairline px-1.5 text-ink-faint line-through">已完成</span>
          <span>日期按{zoneLabel(viewerTimeZone)}显示；待确认的事不画在日历上。</span>
        </p>
      </div>

      <div className="min-w-0 space-y-3" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <h3 className="tabular text-sm font-semibold text-ink">{selected}</h3>
          <AddButton onClick={() => actions.onAdd(selected)}>加到这一天</AddButton>
        </div>
        {selectedItems.length === 0 ? (
          <p className="text-sm text-ink-faint">这一天没有安排。</p>
        ) : (
          selectedItems.map((item) => (
            <EventCard
              key={item.key}
              result={item.result}
              viewerTimeZone={viewerTimeZone}
              pending={false}
              showAccess
              done={item.completion?.state ?? null}
              onDetail={() => actions.onDetail(item)}
              actions={
                item.completion ? (
                  <ActionButton onClick={() => actions.onUncomplete(item)} action="uncomplete">
                    撤销完成
                  </ActionButton>
                ) : (
                  <>
                    <CompleteButton item={item} onComplete={actions.onComplete} />
                    <RemoveButton item={item} onRemove={actions.onRemove} />
                  </>
                )
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
