"use client";

import { useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import type { SubCalendar } from "@/types";
import type { CalendarDeletion } from "@/store/useInterviewStore";
import { CALENDAR_SWATCHES, ColorSwatches } from "@/components/ColorSwatches";

interface CalendarRowProps {
  calendar: SubCalendar;
  /** 该日历名下的面试数量。 */
  count: number;
  /** 可作为迁移目标的其他日历。 */
  others: SubCalendar[];
  onRename: (patch: { name: string; color: string }) => void;
  onDelete: (deletion: CalendarDeletion) => void;
}

type Mode = "idle" | "edit" | "confirm-delete";

export function CalendarRow({
  calendar,
  count,
  others,
  onRename,
  onDelete,
}: CalendarRowProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [name, setName] = useState(calendar.name);
  const [color, setColor] = useState(calendar.color);
  const [target, setTarget] = useState(others[0]?.id ?? "");

  if (mode === "edit") {
    return (
      <div className="rounded-xl border border-hairline p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="分组名称"
          className="w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink"
        />
        <ColorSwatches value={color} onChange={setColor} />
        <div className="mt-2 flex justify-end gap-1.5">
          <RowButton onClick={() => setMode("idle")} label="取消">
            <X size={14} aria-hidden />
          </RowButton>
          <RowButton
            onClick={() => {
              if (name.trim()) onRename({ name: name.trim(), color });
              setMode("idle");
            }}
            label="保存"
            primary
          >
            <Check size={14} aria-hidden />
          </RowButton>
        </div>
      </div>
    );
  }

  if (mode === "confirm-delete") {
    return (
      <div className="rounded-xl border border-hairline p-3">
        <p className="text-xs text-ink">
          {count === 0
            ? `删除「${calendar.name}」？它名下没有面试。`
            : `「${calendar.name}」名下还有 ${count} 场面试。先决定它们去哪儿。`}
        </p>
        {count > 0 && others.length > 0 ? (
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="迁移目标分组"
            className="mt-2 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink"
          >
            {others.map((cal) => (
              <option key={cal.id} value={cal.id}>
                迁移到「{cal.name}」
              </option>
            ))}
          </select>
        ) : null}
        {count > 0 && others.length === 0 ? (
          <p className="mt-2 text-xs text-ink-faint">
            没有其他分组可迁移，只能连同面试一起删除。
          </p>
        ) : null}
        <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">
          <RowButton onClick={() => setMode("idle")} label="取消">
            <X size={14} aria-hidden />
          </RowButton>
          {count > 0 && others.length > 0 ? (
            <button
              type="button"
              onClick={() => onDelete({ kind: "migrate", targetId: target })}
              className="rounded-lg border border-hairline px-2.5 py-1.5 text-xs font-medium text-ink"
            >
              迁移后删除
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDelete({ kind: "purge" })}
            className="rounded-lg bg-drop-soft px-2.5 py-1.5 text-xs font-medium text-on-drop-soft"
          >
            {count > 0 ? `连同 ${count} 场一起删除` : "删除"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-hairline px-3 py-2.5">
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: calendar.color }}
        aria-hidden
      />
      <span className="truncate text-sm text-ink">{calendar.name}</span>
      <span className="shrink-0 text-xs text-ink-faint">{count} 场</span>
      <div className="ml-auto flex shrink-0 gap-1">
        <RowButton
          onClick={() => {
            setName(calendar.name);
            setColor(calendar.color);
            setMode("edit");
          }}
          label={`编辑 ${calendar.name}`}
        >
          <Pencil size={14} aria-hidden />
        </RowButton>
        <RowButton
          onClick={() => {
            setTarget(others[0]?.id ?? "");
            setMode("confirm-delete");
          }}
          label={`删除 ${calendar.name}`}
        >
          <Trash2 size={14} aria-hidden />
        </RowButton>
      </div>
    </div>
  );
}

interface RowButtonProps {
  onClick: () => void;
  label: string;
  primary?: boolean;
  children: React.ReactNode;
}

function RowButton({ onClick, label, primary, children }: RowButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded-lg p-1.5 ${
        primary
          ? "border border-brand-line bg-brand-soft text-ink"
          : "text-ink-faint hover:bg-raised"
      }`}
    >
      {children}
    </button>
  );
}

export { CALENDAR_SWATCHES };
