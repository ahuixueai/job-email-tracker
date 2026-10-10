"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, Reorder, useReducedMotion } from "framer-motion";
import type { Interview, SwipeAction } from "@/types";
import { calcPriority } from "@/lib/priority";
import { useNow } from "@/lib/useNow";
import { LEDGER_SUB_CALENDAR_ID } from "@/lib/ledgerInterviews";
import { MOCK_INTERVIEWS, MOCK_SUB_CALENDARS } from "@/mocks/interviews";
import {
  mergeVisibleOrder,
  orderInterviews,
  useInterviewStore,
} from "@/store/useInterviewStore";
import { InterviewCard } from "@/components/InterviewCard";
import { BoardHeader } from "@/components/BoardHeader";
import { FocusMode } from "@/components/FocusMode";

/** 备战胶囊的自动展开窗口。 */
const PREP_WINDOW_MINUTES = 60;

interface LedgerInterviewsPayload {
  ok: boolean;
  interviews?: Interview[];
  error?: string;
  hint?: string;
}

interface InterviewBoardProps {
  /** true 时加载固定的演示数据（`?seed=demo`），只给 e2e 与手动演示用。 */
  seedDemo?: boolean;
}

export function InterviewBoard({ seedDemo = false }: InterviewBoardProps) {
  const now = useNow();
  const reducedMotion = useReducedMotion() ?? false;

  const storeInterviews = useInterviewStore((s) => s.interviews);
  const storeOrder = useInterviewStore((s) => s.order);
  const storeSubCalendars = useInterviewStore((s) => s.subCalendars);
  const manualOrder = useInterviewStore((s) => s.manualOrder);
  const prepSnoozeUntil = useInterviewStore((s) => s.prepSnoozeUntil);
  const storeFilter = useInterviewStore((s) => s.filterCalendarId);
  const setOrder = useInterviewStore((s) => s.setOrder);
  const nudge = useInterviewStore((s) => s.nudge);
  const setStatus = useInterviewStore((s) => s.setStatus);
  const resortByPriority = useInterviewStore((s) => s.resortByPriority);
  const snoozePrep = useInterviewStore((s) => s.snoozePrep);
  const setFilter = useInterviewStore((s) => s.setFilter);
  const activateImminentDemo = useInterviewStore((s) => s.activateImminentDemo);
  const ensureSubCalendar = useInterviewStore((s) => s.ensureSubCalendar);
  const syncLedgerInterviews = useInterviewStore((s) => s.syncLedgerInterviews);
  const hydrated = useInterviewStore((s) => s.hydrated);

  const [managerOpen, setManagerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [googleOpen, setGoogleOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focusTriggerRef = useRef<HTMLElement | null>(null);
  const bootstrapped = useRef(false);

  // seedDemo 时不打真实台账，直接算「ok」；否则一挂载就在读，默认就是 loading——
  // 不在 effect 里同步调 setState 触发它，那会多切一次没必要的渲染。
  const [ledgerStatus, setLedgerStatus] = useState<"loading" | "ok" | "error">(
    seedDemo ? "ok" : "loading",
  );
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  // 挂载后一次性：先把 localStorage 里的数据读回来，`seed=demo` 时补一次固定演示数据，
  // 再把演示卡片挪到「25 分钟后」。顺序不能反——rehydrate 会整体替换 state，
  // 放在后面会把演示卡的改写冲掉。
  //
  // 最后按当前时间重排一次：order 是存在 localStorage 里的快照，
  // 上次关掉 App 之后时间一直在走，三周后的面试可能已经变成明天的了。
  // 只在打开时排，不随 useNow 每次 tick 排——列表在你眼皮底下自己跳会更糟。
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void Promise.resolve(useInterviewStore.persist.rehydrate()).then(() => {
      const state = useInterviewStore.getState();
      if (seedDemo && state.interviews.length === 0) {
        state.seedDemoData(Date.now());
      }
      activateImminentDemo(Date.now());
      if (!useInterviewStore.getState().manualOrder) {
        useInterviewStore.getState().resortByPriority(Date.now());
      }
    });
  }, [activateImminentDemo, seedDemo]);

  // 独立于 localStorage 的读回：从 ledger.db 同步真实台账。
  // `seed=demo` 是固定的演示/测试数据，不跟真实台账混在一起。
  //
  // 全量同步（更新 + 新增 + 移除），不是只增不减：ledger.db 是唯一数据源，
  // 记录改了时间或被关掉之后看板还留着旧的，显示的就是假的。见 store/reducers.ts。
  //
  // 必须等 rehydrate 完成再同步。localStorage 那份是**同步的输入**——
  // 抢在它前面跑，同步算出来的结果会被随后的 rehydrate 整个覆盖掉，
  // 而这个 effect 不会再跑第二次，等于这一次刷新白同步了。
  useEffect(() => {
    if (seedDemo || !hydrated) return;
    let alive = true;
    fetch("/api/interviews")
      .then((res) => res.json() as Promise<LedgerInterviewsPayload>)
      .then((data) => {
        if (!alive) return;
        if (!data.ok) {
          setLedgerStatus("error");
          setLedgerError(data.hint ?? data.error ?? "读取台账失败");
          return;
        }
        if (data.interviews && data.interviews.length > 0) {
          ensureSubCalendar({
            id: LEDGER_SUB_CALENDAR_ID,
            name: "真实台账",
            color: "#6E9B7A",
            description: "来自 ledger.db，选取口径与 reports/jobhunt.ics 一致",
          });
        }
        // 空数组也要同步：台账清空了，卡片就该跟着清空。
        // 只有读失败才 return（在上面），失败时保持现状不动。
        syncLedgerInterviews(data.interviews ?? [], Date.now());
        setLedgerStatus("ok");
      })
      .catch((e: Error) => {
        if (!alive) return;
        setLedgerStatus("error");
        setLedgerError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [seedDemo, hydrated, ensureSubCalendar, syncLedgerInterviews]);

  // `seed=demo` 且 store 里还没真正写入这份数据时（SSR 首帧、或客户端 hydrate 之前的
  // 那一瞬间），直接用固定 mock 渲染，保证服务端与客户端首帧完全一致，不产生
  // hydration mismatch。挂载后的 effect 会把同一份数据真正写进 store（见上），
  // 写进去之后这里自然切回 store 里的（可编辑的）那一份，不会有两份数据并存。
  const usingMockFallback = seedDemo && storeInterviews.length === 0;
  const interviews = usingMockFallback ? MOCK_INTERVIEWS : storeInterviews;
  const subCalendars = usingMockFallback ? MOCK_SUB_CALENDARS : storeSubCalendars;
  const order = usingMockFallback ? MOCK_INTERVIEWS.map((i) => i.id) : storeOrder;

  const calendarById = useMemo(
    () => new Map(subCalendars.map((c) => [c.id, c])),
    [subCalendars],
  );
  // 筛选的那个日历可能已经被删掉了，兜底回「全部」。
  const activeFilter =
    storeFilter && calendarById.has(storeFilter) ? storeFilter : null;

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of interviews) {
      map.set(item.subCalendarId, (map.get(item.subCalendarId) ?? 0) + 1);
    }
    return map;
  }, [interviews]);

  const ordered = useMemo(
    () => orderInterviews(interviews, order),
    [interviews, order],
  );
  const visible = useMemo(
    () =>
      activeFilter
        ? ordered.filter((item) => item.subCalendarId === activeFilter)
        : ordered,
    [ordered, activeFilter],
  );

  const handleReorder = useCallback(
    (next: Interview[]) =>
      setOrder(mergeVisibleOrder(order, next.map((i) => i.id))),
    [order, setOrder],
  );

  const openForm = useCallback((id: string | null) => {
    setEditingId(id);
    setFormOpen(true);
    setManagerOpen(false);
  }, []);

  const exitFocus = useCallback(() => {
    setFocusId(null);
    focusTriggerRef.current?.focus();
    focusTriggerRef.current = null;
  }, []);

  const focusInterview = focusId
    ? (interviews.find((i) => i.id === focusId) ?? null)
    : null;

  // localStorage 没读完，或者当前没有任何数据、ledger 同步还没出结果——
  // 两种情况都可能在下一刻冒出真实数据，先给骨架而不是空状态，避免闪一下又变。
  const showSkeleton = !hydrated || (ledgerStatus === "loading" && interviews.length === 0);
  const showEmpty = !showSkeleton && interviews.length === 0;

  return (
    <section className="mx-auto w-full max-w-xl px-4 pb-16">
      <BoardHeader
        interviews={interviews}
        calendars={subCalendars}
        counts={counts}
        visibleCount={visible.length}
        now={now}
        manualOrder={manualOrder}
        reducedMotion={reducedMotion}
        managerOpen={managerOpen}
        filterCalendarId={activeFilter}
        formOpen={formOpen}
        googleOpen={googleOpen}
        backupOpen={backupOpen}
        funnelOpen={funnelOpen}
        editingInterview={
          editingId ? (interviews.find((i) => i.id === editingId) ?? null) : null
        }
        onResort={() => resortByPriority(Date.now())}
        onToggleManager={() => setManagerOpen((open) => !open)}
        onNewInterview={() => (formOpen ? setFormOpen(false) : openForm(null))}
        onToggleGoogle={() => setGoogleOpen((open) => !open)}
        onToggleBackup={() => setBackupOpen((open) => !open)}
        onToggleFunnel={() => setFunnelOpen((open) => !open)}
        onCloseForm={() => setFormOpen(false)}
        onFilter={setFilter}
      />

      {ledgerStatus === "error" ? (
        <div
          role="status"
          className="mb-3 rounded-xl border border-hairline bg-surface p-3 text-sm text-on-drop-soft"
          data-ledger-error
        >
          读不到真实台账：{ledgerError}
        </div>
      ) : null}

      {showSkeleton ? <BoardSkeleton /> : null}
      {showEmpty ? <BoardEmpty /> : null}

      <Reorder.Group
        axis="y"
        style={{ display: showSkeleton || showEmpty ? "none" : undefined }}
        values={visible}
        onReorder={handleReorder}
        layoutScroll
        className="flex flex-col gap-3"
      >
        {visible.map((interview, index) => {
          const minutesUntilStart = Math.round(
            (Date.parse(interview.startUtc) - now) / 60_000,
          );
          const inWindow =
            interview.status === "scheduled" &&
            minutesUntilStart <= PREP_WINDOW_MINUTES &&
            now < Date.parse(interview.endUtc);
          return (
            <InterviewCard
              key={interview.id}
              interview={interview}
              subCalendar={calendarById.get(interview.subCalendarId)}
              score={calcPriority(interview, now)}
              now={now}
              index={index}
              total={visible.length}
              reducedMotion={reducedMotion}
              prepOpen={inWindow && now >= (prepSnoozeUntil[interview.id] ?? 0)}
              minutesUntilStart={minutesUntilStart}
              onMove={nudge}
              onAction={(id: string, action: SwipeAction) =>
                setStatus(id, action, Date.now())
              }
              onRestore={(id: string) => setStatus(id, "scheduled", Date.now())}
              onCollapsePrep={(id: string) => snoozePrep(id, Date.now())}
              onEdit={openForm}
              onEnterFocus={(id: string, trigger: HTMLElement) => {
                focusTriggerRef.current = trigger;
                setFocusId(id);
              }}
            />
          );
        })}
      </Reorder.Group>

      <AnimatePresence>
        {focusInterview ? (
          <FocusMode
            interview={focusInterview}
            reducedMotion={reducedMotion}
            onExit={exitFocus}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}

/**
 * localStorage 读回来之前的占位。
 * 不直接渲染 mock 数据——老用户会先看到一堆不属于自己的卡片再被替换掉。
 */
function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-3" data-skeleton aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[168px] animate-pulse rounded-card border border-hairline bg-surface"
        />
      ))}
    </div>
  );
}

/**
 * 真正的空状态：本地没有手动新建的面试，ledger.db 也没有在推进的记录。
 * 不显示别人的公司名（Stripe / 字节跳动）充数——那是假数据，会让新用户以为账号窜了。
 * 见 docs/产品完整性清单.md §2.1。
 */
function BoardEmpty() {
  return (
    <div
      data-board-empty
      className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-hairline px-6 py-16 text-center"
    >
      <p className="text-sm font-medium text-ink">还没有安排</p>
      <p className="max-w-xs text-xs text-ink-soft">
        配好邮件转发后，笔试 / 面试会自动出现在这里；也可以先点右上角「+」手动新建一场。
      </p>
    </div>
  );
}
