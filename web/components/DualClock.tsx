"use client";

import { isSameZone, toZonedTime } from "@/lib/time";
import { useViewerTimeZone } from "@/components/TimeZoneProvider";
import type { IanaTimeZone, UtcIsoString } from "@/types";

interface DualClockProps {
  startUtc: UtcIsoString;
  sourceTimeZone: IanaTimeZone;
  timePrecision: "timed" | "date";
  sourceTimeZoneConfirmed: boolean;
}

/**
 * 时间/时区展示，按精度与确定性分三种：
 *
 *   timed + 时区确认过   → 双时区并排（面试当地 / 你所在地），现在的样子
 *   timed + 时区没确认过 → 只显示一个钟点，明说「时区未确认」，不换算第二栏——
 *                          拿一个不确定的时区去二次运算只会把误差乘大，不是抵消
 *   date（只知道日期）    → 不显示任何钟点，只显示日期。startUtc/endUtc 在这种
 *                          情况下是「那一天在 sourceTimeZone 下」的全天窗口，
 *                          不是真实开始/结束时刻，画成钟点就是把「不知道」
 *                          显示成「知道」——警告不能用来抵消编造，不确定就不写。
 *
 * 本机时区来自 TimeZoneProvider——非首次访问时它由 cookie 在 SSR 阶段就已确定，
 * 首屏直接是最终布局。首次访问拿不到（null），退化成左块占满整行，
 * hydration 检测出来后再补上右列。
 */
export function DualClock({
  startUtc,
  sourceTimeZone,
  timePrecision,
  sourceTimeZoneConfirmed,
}: DualClockProps) {
  const viewerZone = useViewerTimeZone();

  if (timePrecision === "date") {
    // 用 sourceTimeZone 把 startUtc 格式化回日期：由于 startUtc 本来就是
    // 「那一天 00:00 在 sourceTimeZone 下」换算出来的，这里能精确地把
    // 原始日期还原回来，不受查看者所在时区影响。
    const { date } = toZonedTime(startUtc, sourceTimeZone);
    return (
      <div className="rounded-xl bg-brand-soft px-3 py-2">
        <span className="text-xs text-ink-soft">全天 · 具体时间未定</span>
        <p className="mt-0.5 text-lg font-semibold leading-tight text-ink">{date}</p>
      </div>
    );
  }

  const source = toZonedTime(startUtc, sourceTimeZone);

  if (!sourceTimeZoneConfirmed) {
    return (
      <div className="grid grid-cols-1">
        <ClockColumn
          label="面试当地"
          date={source.date}
          time={source.time}
          abbr={source.abbr}
          note="时区未确认，未换算本地时间"
          emphasis
        />
      </div>
    );
  }

  const identical = !viewerZone || isSameZone(sourceTimeZone, viewerZone);
  const local = identical ? null : toZonedTime(startUtc, viewerZone);

  return (
    <div className={local ? "grid grid-cols-2 gap-3" : "grid grid-cols-1"}>
      <ClockColumn
        label="面试当地"
        date={source.date}
        time={source.time}
        abbr={source.abbr}
        note={viewerZone && identical ? "与你所在时区相同" : null}
        emphasis
      />
      {local ? (
        <ClockColumn
          label="你所在地"
          date={local.date}
          time={local.time}
          abbr={local.abbr}
          note={null}
        />
      ) : null}
    </div>
  );
}

interface ClockColumnProps {
  label: string;
  date: string;
  time: string;
  abbr: string;
  note: string | null;
  emphasis?: boolean;
}

function ClockColumn({
  label,
  date,
  time,
  abbr,
  note,
  emphasis,
}: ClockColumnProps) {
  return (
    <div
      className={`rounded-xl px-3 py-2 ${
        emphasis ? "bg-brand-soft" : "bg-raised"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-soft">
          {label}
          {note ? (
            <span className="ml-1.5 text-ink-faint">· {note}</span>
          ) : null}
        </span>
        <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink-soft">
          {abbr}
        </span>
      </div>
      <p className="tabular mt-0.5 text-lg font-semibold leading-tight text-ink">
        {time}
      </p>
      <p className="text-xs text-ink-soft">{date}</p>
    </div>
  );
}
