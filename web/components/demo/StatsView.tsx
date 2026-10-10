import type { DayLoad, FunnelStep, HandlingCount, Kpis, StageCount, WeekCount } from "@/lib/demo/stats";

export interface StatsData {
  kpis: Kpis;
  funnel: readonly FunnelStep[];
  stages: readonly StageCount[];
  upcoming: readonly DayLoad[];
  weekly: readonly WeekCount[];
  handling: readonly HandlingCount[];
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;

/**
 * 「统计」视图。每张图只回答一个问题，问题就写在图的标题里。
 *
 * 画法上的几条约定：
 * - 单一系列的图只用一种颜色，数值直接写在条形旁边，不让人对着坐标轴估。
 * - 只有「接下来两周」那张有两个系列，带图例，颜色之外数值也写出来。
 * - 文字一律用正文色，不跟着条形变色。
 */
export function StatsView({ data }: { data: StatsData }) {
  const { kpis } = data;
  const totalHandled = data.handling.reduce((sum, h) => sum + h.count, 0);
  const auto = data.handling.find((h) => h.id === "auto")?.count ?? 0;
  const ignored = data.handling.find((h) => h.id === "ignored")?.count ?? 0;

  return (
    <div className="space-y-5" data-stats>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="投了多少家" value={kpis.applications} />
        <Tile label="还在流程里" value={kpis.active} hint="没收到拒信，也还没拿到 Offer" />
        <Tile label="未来 7 天要做的事" value={kpis.dueThisWeek} />
        <Tile label="等你确认" value={kpis.pending} />
      </dl>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="投出去的简历，各走到了哪一步？" note="每一步是「至少走到这一步」的公司数。右边的百分比是相对上一步。">
          <ul className="space-y-3" data-chart="funnel">
            {data.funnel.map((step) => (
              <li key={step.reach} title={`${step.label}：${step.count} 家，占全部投递的 ${pct(step.share)}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink">{step.label}</span>
                  <span className="tabular text-ink">
                    <span className="font-semibold">{step.count}</span> 家
                    {step.fromPrevious !== null ? (
                      <span className="ml-2 text-xs text-ink-faint">上一步的 {pct(step.fromPrevious)}</span>
                    ) : null}
                  </span>
                </div>
                <Bar share={step.share} tone="chart-1" />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="现在各停在哪个状态？" note="每家公司只算一次，加起来等于投递总数。">
          <HBars
            chart="stages"
            rows={data.stages.map((s) => ({ key: s.stage, label: s.label, count: s.count }))}
            unit="家"
          />
        </Panel>

        <Panel title="接下来两周，哪几天有事？" note="日期按你所在的时区算，和日历一致。">
          <UpcomingChart days={data.upcoming} />
        </Panel>

        <Panel title="最近每周收到多少封求职邮件？" note="验证码和广告不算。">
          <Columns
            chart="weekly"
            columns={data.weekly.map((w) => ({ key: w.weekStart, label: w.label, count: w.count }))}
            unit="封"
          />
        </Panel>

        <Panel
          wide
          title="这些邮件，有多少是系统自己处理完的？"
          note={
            totalHandled === 0
              ? "还没有邮件。"
              : `${totalHandled} 封里，${auto + ignored} 封不用你动手（${pct((auto + ignored) / totalHandled)}）。按系统最初的判断算，你后来点的确认不计入。`
          }
        >
          <HBars
            chart="handling"
            rows={data.handling.map((h) => ({ key: h.id, label: h.label, count: h.count }))}
            unit="封"
          />
        </Panel>
      </div>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4" data-kpi={label}>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="tabular mt-1 text-3xl font-semibold text-ink">{value}</dd>
      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

function Panel({
  title,
  note,
  wide = false,
  children,
}: {
  title: string;
  note: string;
  /** 占满一整行。 */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-hairline bg-surface p-4 sm:p-5 ${wide ? "lg:col-span-2" : ""}`}>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
      <p className="mt-4 text-xs leading-relaxed text-ink-faint">{note}</p>
    </section>
  );
}

/** 一根横条。零值留一条轨道，看得出「这里是 0」而不是「这里没画」。 */
function Bar({ share, tone }: { share: number; tone: "chart-1" | "chart-2" }) {
  return (
    <div className="mt-1.5 h-2.5 rounded-full bg-raised" aria-hidden>
      {share > 0 ? (
        <div
          className={`h-full rounded-full ${tone === "chart-1" ? "bg-chart-1" : "bg-chart-2"}`}
          style={{ width: `${Math.max(share * 100, 2)}%` }}
        />
      ) : null}
    </div>
  );
}

function HBars({
  rows,
  unit,
  chart,
}: {
  rows: readonly { key: string; label: string; count: number }[];
  unit: string;
  chart: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-2.5" data-chart={chart}>
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-x-3 text-sm" title={`${row.label}：${row.count} ${unit}`}>
          <span className="text-ink">{row.label}</span>
          <div className="h-2.5 rounded-full bg-raised" aria-hidden>
            {row.count > 0 ? (
              <div className="h-full rounded-full bg-chart-1" style={{ width: `${(row.count / max) * 100}%` }} />
            ) : null}
          </div>
          <span className="tabular text-right text-ink">
            <span className="font-semibold">{row.count}</span>
            <span className="ml-0.5 text-xs text-ink-faint">{unit}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const PLOT_HEIGHT = 112;

function Columns({
  columns,
  unit,
  chart,
}: {
  columns: readonly { key: string; label: string; count: number }[];
  unit: string;
  chart: string;
}) {
  const max = Math.max(1, ...columns.map((c) => c.count));
  return (
    <ul className="flex items-end gap-2" data-chart={chart}>
      {columns.map((column) => (
        <li key={column.key} className="flex min-w-0 flex-1 flex-col items-center" title={`${column.label}：${column.count} ${unit}`}>
          <span className="tabular text-xs font-semibold text-ink">{column.count}</span>
          <div className="mt-1 flex w-full items-end justify-center border-b border-hairline" style={{ height: PLOT_HEIGHT }} aria-hidden>
            {column.count > 0 ? (
              <div className="w-full max-w-10 rounded-t bg-chart-1" style={{ height: `${(column.count / max) * 100}%` }} />
            ) : null}
          </div>
          <span className="mt-1.5 w-full truncate text-center text-[11px] text-ink-faint">{column.label}</span>
        </li>
      ))}
    </ul>
  );
}

function UpcomingChart({ days }: { days: readonly DayLoad[] }) {
  const max = Math.max(1, ...days.map((d) => d.fixed + d.deadline));
  const total = days.reduce((sum, d) => sum + d.fixed + d.deadline, 0);
  return (
    <div data-chart="upcoming">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-chart-2" aria-hidden />
          要准点到
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-chart-1" aria-hidden />
          当天截止
        </span>
      </p>
      {total === 0 ? (
        <p className="mt-4 text-sm text-ink-faint">接下来两周日程上没有带时间的安排。</p>
      ) : (
        <ul className="mt-3 flex items-end gap-1">
          {days.map((day, index) => {
            const sum = day.fixed + day.deadline;
            return (
              <li
                key={day.dateKey}
                className="flex min-w-0 flex-1 flex-col items-center"
                title={`${day.label} ${day.weekday}：准点 ${day.fixed} 件，截止 ${day.deadline} 件`}
              >
                <span className="tabular h-4 text-xs font-semibold text-ink">{sum > 0 ? sum : ""}</span>
                <div
                  className="mt-1 flex w-full flex-col-reverse items-center gap-0.5 border-b border-hairline"
                  style={{ height: PLOT_HEIGHT }}
                  aria-hidden
                >
                  {day.deadline > 0 ? (
                    <div className="w-full max-w-7 rounded-t-sm bg-chart-1" style={{ height: `${(day.deadline / max) * 100}%` }} />
                  ) : null}
                  {day.fixed > 0 ? (
                    <div className="w-full max-w-7 rounded-t-sm bg-chart-2" style={{ height: `${(day.fixed / max) * 100}%` }} />
                  ) : null}
                </div>
                {/* 14 根柱子挤不下「10/14」：只写日，月份只在第一根和每月 1 日出现 */}
                <span className="tabular mt-1.5 text-[11px] whitespace-nowrap text-ink-faint">
                  {index === 0 || day.label.endsWith("/1") ? day.label : day.label.split("/")[1]}
                </span>
                <span className="text-[10px] text-ink-faint">{day.weekday.slice(1)}</span>
                <span className="sr-only">
                  准点 {day.fixed} 件，截止 {day.deadline} 件
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
