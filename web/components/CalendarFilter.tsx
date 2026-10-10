"use client";

import type { SubCalendar } from "@/types";

interface CalendarFilterProps {
  calendars: readonly SubCalendar[];
  active: string | null;
  counts: ReadonlyMap<string, number>;
  total: number;
  onChange: (calendarId: string | null) => void;
}

/** 子日历筛选条。只有一个子日历时不显示——那时候筛选没有意义。 */
export function CalendarFilter({
  calendars,
  active,
  counts,
  total,
  onChange,
}: CalendarFilterProps) {
  if (calendars.length < 2) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      <Chip active={active === null} onClick={() => onChange(null)}>
        全部 {total}
      </Chip>
      {calendars.map((calendar) => (
        <Chip
          key={calendar.id}
          active={active === calendar.id}
          onClick={() => onChange(calendar.id)}
          color={calendar.color}
        >
          {calendar.name} {counts.get(calendar.id) ?? 0}
        </Chip>
      ))}
    </div>
  );
}

interface ChipProps {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}

function Chip({ active, color, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
        active
          ? "border-brand-line bg-brand-soft text-ink"
          : "border-hairline bg-surface text-ink-soft"
      }`}
    >
      {color ? (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
}
