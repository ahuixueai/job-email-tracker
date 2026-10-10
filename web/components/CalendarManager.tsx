"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { X, Plus } from "lucide-react";
import { useInterviewStore } from "@/store/useInterviewStore";
import { CalendarRow } from "@/components/CalendarRow";
import { CALENDAR_SWATCHES, ColorSwatches } from "@/components/ColorSwatches";
import { SPRING } from "@/lib/motion";

interface CalendarManagerProps {
  reducedMotion: boolean;
  onClose: () => void;
}

export function CalendarManager({ reducedMotion, onClose }: CalendarManagerProps) {
  const subCalendars = useInterviewStore((s) => s.subCalendars);
  const interviews = useInterviewStore((s) => s.interviews);
  const createSubCalendar = useInterviewStore((s) => s.createSubCalendar);
  const updateSubCalendar = useInterviewStore((s) => s.updateSubCalendar);
  const deleteSubCalendar = useInterviewStore((s) => s.deleteSubCalendar);

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CALENDAR_SWATCHES[0]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of interviews) {
      map.set(item.subCalendarId, (map.get(item.subCalendarId) ?? 0) + 1);
    }
    return map;
  }, [interviews]);

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={reducedMotion ? { duration: 0 } : SPRING}
      className="mt-3 rounded-card border border-hairline bg-surface p-3 shadow-card"
    >
      <div className="flex items-center justify-between">
        {/*
          标题回答「它替我干什么」，不是「它是什么」。
          「子日历」是这东西的内部名字，用户看了不知道选它有什么用
          （作者原话：「我选子日历是用来干什么的这还不明确」）。
          用「分组 + 收益」一句话说清，比再加一段解释文字有效。
        */}
        <h2 className="text-sm font-semibold text-ink">分组：只看其中一条线</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭分组管理"
          title="关闭"
          className="rounded-lg p-1.5 text-ink-faint hover:bg-raised"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <div className="mt-2.5 flex flex-col gap-2">
        {subCalendars.map((calendar) => (
          <CalendarRow
            key={calendar.id}
            calendar={calendar}
            count={counts.get(calendar.id) ?? 0}
            others={subCalendars.filter((c) => c.id !== calendar.id)}
            onRename={(patch) => updateSubCalendar(calendar.id, patch)}
            onDelete={(deletion) => deleteSubCalendar(calendar.id, deletion)}
          />
        ))}
        {subCalendars.length === 0 ? (
          <p className="rounded-xl border border-dashed border-hairline px-3 py-4 text-center text-xs text-ink-faint">
            还没有分组。新建一个再往里放面试。
          </p>
        ) : null}
      </div>

      <div className="mt-3 rounded-xl border border-dashed border-hairline p-3">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="新建分组，例如「春招 - 后端」"
          aria-label="新分组名称"
          className="w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint"
        />
        <ColorSwatches value={color} onChange={setColor} />
        <motion.button
          type="button"
          whileTap={reducedMotion ? undefined : { scale: 0.96 }}
          transition={SPRING}
          disabled={!name.trim()}
          onClick={() => {
            createSubCalendar({ name: name.trim(), color });
            setName("");
          }}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-line bg-brand-soft px-3 py-2 text-xs font-semibold text-ink disabled:opacity-40"
        >
          <Plus size={14} aria-hidden />
          新建
        </motion.button>
      </div>
    </motion.div>
  );
}
