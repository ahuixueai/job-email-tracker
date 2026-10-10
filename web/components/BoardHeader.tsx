"use client";

import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Keyboard } from "lucide-react";
import type { Interview, SubCalendar } from "@/types";
import { InterviewForm } from "@/components/InterviewForm";
import { HeaderControls } from "@/components/HeaderControls";
import { CalendarFilter } from "@/components/CalendarFilter";
import { CalendarManager } from "@/components/CalendarManager";
import { PepTalkBanner } from "@/components/PepTalkBanner";
import { GooglePanel } from "@/components/GooglePanel";
import { BackupPanel } from "@/components/BackupPanel";
import { FunnelPanel } from "@/components/FunnelPanel";

interface BoardHeaderProps {
  interviews: readonly Interview[];
  calendars: readonly SubCalendar[];
  counts: ReadonlyMap<string, number>;
  visibleCount: number;
  now: number;
  manualOrder: boolean;
  reducedMotion: boolean;
  managerOpen: boolean;
  formOpen: boolean;
  googleOpen: boolean;
  backupOpen: boolean;
  funnelOpen: boolean;
  editingInterview: Interview | null;
  filterCalendarId: string | null;
  onResort: () => void;
  onToggleManager: () => void;
  onNewInterview: () => void;
  onToggleGoogle: () => void;
  onToggleBackup: () => void;
  onToggleFunnel: () => void;
  onCloseForm: () => void;
  onFilter: (calendarId: string | null) => void;
}

export function BoardHeader(props: BoardHeaderProps) {
  return (
    <header className="pt-8 pb-6">
      <p className="text-xs tracking-widest text-ink-faint">JOB COMMAND CENTER</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">接下来的安排</h1>
      {/*
        标题只说「有多少场」，不教手势。第一次打开的人要先看见自己的安排，
        不是先上一堂三个手势的课——手势说明挪到了页脚那一行（见本文件底部）。
      */}
      <p className="mt-1.5 text-sm text-ink-soft">{props.visibleCount} 场在列</p>
      <Link
        href="/"
        className="mt-1 inline-block text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        回到新版看板
      </Link>

      <HeaderControls
        reducedMotion={props.reducedMotion}
        manualOrder={props.manualOrder}
        managerOpen={props.managerOpen}
        formOpen={props.formOpen}
        googleOpen={props.googleOpen}
        backupOpen={props.backupOpen}
        funnelOpen={props.funnelOpen}
        onResort={props.onResort}
        onToggleManager={props.onToggleManager}
        onNewInterview={props.onNewInterview}
        onToggleGoogle={props.onToggleGoogle}
        onToggleBackup={props.onToggleBackup}
        onToggleFunnel={props.onToggleFunnel}
      />

      <CalendarFilter
        calendars={props.calendars}
        active={props.filterCalendarId}
        counts={props.counts}
        total={props.interviews.length}
        onChange={props.onFilter}
      />

      <AnimatePresence initial={false}>
        {props.formOpen ? (
          <InterviewForm
            key={props.editingInterview?.id ?? "new"}
            editing={props.editingInterview}
            reducedMotion={props.reducedMotion}
            onClose={props.onCloseForm}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {props.funnelOpen ? (
          <FunnelPanel
            reducedMotion={props.reducedMotion}
            onClose={props.onToggleFunnel}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {props.backupOpen ? (
          <BackupPanel
            reducedMotion={props.reducedMotion}
            onClose={props.onToggleBackup}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {props.googleOpen ? (
          <GooglePanel
            reducedMotion={props.reducedMotion}
            onClose={props.onToggleGoogle}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {props.managerOpen ? (
          <CalendarManager
            reducedMotion={props.reducedMotion}
            onClose={props.onToggleManager}
          />
        ) : null}
      </AnimatePresence>

      <PepTalkBanner interviews={props.interviews} now={props.now} />

      {/*
        手势与键盘说明合并成一行，且**移动端整行不渲染**（hidden sm:flex）。
        手机上没有 Tab 键也没有 Alt 键，这行在那里是纯噪音；
        而手势本身在手机上是自解释的——手指划一下就知道了，不需要先读说明。
      */}
      <p className="mt-4 hidden items-center gap-1.5 text-xs text-ink-faint sm:flex">
        <Keyboard size={13} aria-hidden />
        左滑记 Offer，右滑收进已结束，上下拖动改顺序；Tab 聚焦卡片后 Alt + ↑ / ↓ 同样可以
      </p>
    </header>
  );
}
