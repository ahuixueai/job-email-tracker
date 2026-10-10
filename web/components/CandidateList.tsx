"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { EventCandidate } from "@/lib/integrations/parseCalendar";
import { toZonedTime } from "@/lib/time";

interface CandidateListProps {
  candidates: EventCandidate[];
  onCancel: () => void;
  onConfirm: (chosen: EventCandidate[]) => void;
}

/**
 * 解析结果先给用户过目再入库。
 *
 * 从标题里拆公司和岗位是启发式，一定会有拆错的；直接写进列表的话，
 * 用户得逐条去改，比自己建还麻烦。默认全选，取消掉不要的即可。
 */
export function CandidateList({ candidates, onCancel, onConfirm }: CandidateListProps) {
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(candidates.map((c) => c.externalId)),
  );

  if (candidates.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-hairline px-3 py-4 text-center text-xs text-ink-faint">
        未来 45 天里没找到像面试的日程。
      </p>
    );
  }

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-2">
      {candidates.map((candidate) => {
        const local = toZonedTime(candidate.startUtc, candidate.sourceTimeZone);
        return (
          <label
            key={candidate.externalId}
            className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-hairline p-2.5"
          >
            <input
              type="checkbox"
              checked={chosen.has(candidate.externalId)}
              onChange={() => toggle(candidate.externalId)}
              className="mt-0.5 accent-[var(--jcc-brand-line)]"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">
                {candidate.company}
              </span>
              <span className="block truncate text-xs text-ink-soft">
                {candidate.position}
              </span>
              <span className="tabular mt-0.5 block text-xs text-ink-faint">
                {local.date} {local.time} {local.abbr}
                {candidate.meetingUrl ? " · 含会议链接" : ""}
              </span>
              <span className="mt-0.5 block text-xs text-ink-faint">
                命中：{candidate.matched.slice(0, 4).join("、")}
              </span>
            </span>
          </label>
        );
      })}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs text-ink-soft hover:bg-raised"
        >
          取消
        </button>
        <button
          type="button"
          disabled={chosen.size === 0}
          onClick={() =>
            onConfirm(candidates.filter((c) => chosen.has(c.externalId)))
          }
          className="flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand-soft px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
        >
          <Check size={13} aria-hidden />
          导入选中的 {chosen.size} 场
        </button>
      </div>
    </div>
  );
}
