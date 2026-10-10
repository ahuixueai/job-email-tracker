"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Focus } from "lucide-react";
import type { Interview, SubCalendar } from "@/types";
import { INSTANT, SPRING } from "@/lib/motion";
import { CardBody } from "@/components/CardBody";
import { PrepCapsule } from "@/components/PrepCapsule";
import { SettledRow } from "@/components/SettledRow";

interface CardContentProps {
  interview: Interview;
  subCalendar: SubCalendar | undefined;
  score: number;
  now: number;
  reducedMotion: boolean;
  /** 是否处于备战窗口且未被折叠。 */
  prepOpen: boolean;
  minutesUntilStart: number;
  onCollapsePrep: () => void;
  onEnterFocus: (trigger: HTMLElement) => void;
}

/**
 * 卡片的内容层（不含手势）。抽出来是为了让 InterviewCard 专心做手势仲裁，
 * 两边都能各自留在 200 行以内。
 */
export function CardContent(props: CardContentProps) {
  const { interview, reducedMotion, prepOpen } = props;
  const [notesOpen, setNotesOpen] = useState(false);

  if (interview.status === "rejected") {
    return <SettledRow interview={interview} />;
  }

  return (
    <>
      <CardBody
        interview={interview}
        subCalendar={props.subCalendar}
        score={props.score}
        now={props.now}
      />

      {interview.type === "assessment" && interview.status === "scheduled" ? (
        <div className="px-4 pb-3 sm:px-5">
          <motion.button
            type="button"
            whileTap={reducedMotion ? undefined : { scale: 0.96 }}
            transition={SPRING}
            onClick={(event) => props.onEnterFocus(event.currentTarget)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-line bg-brand-soft px-3 py-2 text-xs font-semibold text-ink"
          >
            <Focus size={14} aria-hidden />
            进入专注模式
          </motion.button>
        </div>
      ) : null}

      {/* layout 动画负责高度过渡，减少动效时退化为瞬时出现 */}
      <AnimatePresence initial={false}>
        {prepOpen ? (
          <motion.div
            key="prep"
            layout
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reducedMotion ? { height: 0 } : { height: 0, opacity: 0 }}
            transition={reducedMotion ? INSTANT : SPRING}
            className="overflow-hidden"
          >
            <PrepCapsule
              prep={interview.prep}
              minutesUntilStart={props.minutesUntilStart}
              reducedMotion={reducedMotion}
              onCollapse={props.onCollapsePrep}
              onOpenNotes={() => setNotesOpen((open) => !open)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {prepOpen && notesOpen && interview.prep.jdNotes ? (
          <motion.div
            key="notes"
            layout
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reducedMotion ? INSTANT : SPRING}
            className="overflow-hidden"
          >
            <p className="border-t border-hairline px-4 py-3 text-xs leading-relaxed text-ink-soft sm:px-5">
              {interview.prep.jdNotes}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
