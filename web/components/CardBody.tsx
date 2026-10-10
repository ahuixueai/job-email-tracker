"use client";

import { Clock3, Star, Video, Laptop, Phone, MapPin, UserRound } from "lucide-react";
import type { Interview, SubCalendar } from "@/types";
import { TYPE_LABEL, STATUS_LABEL } from "@/lib/motion";
import { formatCountdown, formatDuration } from "@/lib/time";
import { MAX_PRIORITY_SCORE, isHighPriority } from "@/lib/priority";
import { DualClock } from "@/components/DualClock";

const TYPE_ICON = {
  video: Video,
  onsite: MapPin,
  phone: Phone,
  assessment: Laptop,
  hr: UserRound,
} as const;

interface CardBodyProps {
  interview: Interview;
  subCalendar: SubCalendar | undefined;
  score: number;
  now: number;
}

export function CardBody({ interview, subCalendar, score, now }: CardBodyProps) {
  const TypeIcon = TYPE_ICON[interview.type];
  const high = isHighPriority(score) && interview.status === "scheduled";
  // 分数不再常驻占位，只在 hover / 聚焦徽章时以 tooltip 揭示。
  const scoreHint = `优先级得分 ${score} / ${MAX_PRIORITY_SCORE}${
    high ? "（最高优先级）" : ""
  }`;

  return (
    <div className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {subCalendar ? (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: subCalendar.color }}
                aria-hidden
              />
            ) : null}
            <span className="truncate text-xs text-ink-soft">
              {subCalendar?.name ?? "未归类"}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-2">
            {high ? (
              <span
                title={scoreHint}
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
              >
                <Star size={11} fill="currentColor" />
              </span>
            ) : null}
            <h3 className="truncate text-base font-semibold text-ink" title={scoreHint}>
              {interview.company}
            </h3>
          </div>
          <p className="truncate text-sm text-ink-soft">{interview.position}</p>
        </div>

        <span className="shrink-0 rounded-full bg-raised px-2.5 py-1 text-xs text-ink-soft">
          {STATUS_LABEL[interview.status]}
        </span>
      </div>

      <div className="mt-3.5">
        <DualClock
          startUtc={interview.startUtc}
          sourceTimeZone={interview.sourceTimeZone}
          timePrecision={interview.timePrecision}
          sourceTimeZoneConfirmed={interview.sourceTimeZoneConfirmed}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <TypeIcon size={13} aria-hidden />
          {TYPE_LABEL[interview.type]}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock3 size={13} aria-hidden />
          {interview.timePrecision === "date" ? (
            formatCountdown(interview.startUtc, now)
          ) : (
            <>
              {formatCountdown(interview.startUtc, now)} ·{" "}
              {formatDuration(interview.startUtc, interview.endUtc)}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

