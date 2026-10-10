"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Interview, InterviewStatus, SubCalendar } from "@/types";
import { IMMINENT_DEMO_ID, MOCK_INTERVIEWS, MOCK_SUB_CALENDARS } from "@/mocks/interviews";
import { sortByPriority } from "@/lib/priority";
import * as R from "@/store/reducers";
import type { BoardData, CalendarDeletion } from "@/store/reducers";

export type { CalendarDeletion } from "@/store/reducers";
export { orderInterviews, mergeVisibleOrder, newId } from "@/store/reducers";

/** 手动折叠备战胶囊后的静默期：5 分钟内不自动重新展开。 */
export const PREP_SNOOZE_MS = 5 * 60 * 1000;

/** 新建面试的入参：id 由 store 生成，其余字段调用方给全。 */
export type NewInterview = Omit<Interview, "id">;

interface InterviewState extends BoardData {
  /** localStorage 是否已经读回来。读回来之前列表渲染骨架，避免闪 mock 数据。 */
  hydrated: boolean;
  markHydrated: () => void;

  setOrder: (order: string[]) => void;
  nudge: (id: string, delta: -1 | 1) => void;
  setStatus: (id: string, status: InterviewStatus, now: number) => void;
  resortByPriority: (now: number) => void;
  snoozePrep: (id: string, now: number) => void;
  setFilter: (calendarId: string | null) => void;

  addInterview: (input: NewInterview, now: number) => string;
  updateInterview: (
    id: string,
    patch: Partial<Omit<Interview, "id">>,
    now: number,
  ) => void;
  removeInterview: (id: string) => void;
  /** 批量导入（Google Calendar / 邮件解析用），按 externalId 去重。只增不减。 */
  importInterviews: (items: NewInterview[], now: number) => number;
  /**
   * 与 ledger.db 做一次全量同步：更新、新增、移除三件事一起做。
   * 和 importInterviews 的区别是**替换语义**——台账里不再出现的记录，卡片要消失。
   */
  syncLedgerInterviews: (items: NewInterview[], now: number) => void;

  /** 导入备份：整体替换或合并后的结果一次性写入。 */
  applyBackup: (payload: {
    interviews: Interview[];
    subCalendars: SubCalendar[];
    order: string[];
    manualOrder: boolean;
  }) => void;

  createSubCalendar: (input: { name: string; color: string }) => string;
  updateSubCalendar: (id: string, patch: Partial<Omit<SubCalendar, "id">>) => void;
  deleteSubCalendar: (id: string, deletion: CalendarDeletion) => void;
  activateImminentDemo: (now: number) => void;
  /** 加一个子日历，id 已存在则什么都不做。给 ledger 同步这类固定 id 的场景用。 */
  ensureSubCalendar: (calendar: SubCalendar) => void;
  /** 仅供 `?seed=demo` 的演示/测试路径调用，真实用户永远不会自动触发。 */
  seedDemoData: (now: number) => void;
}

/**
 * 生产环境的真实起点：空。真实数据来自 /api/interviews（ledger.db）
 * 和用户手动新建，**不再用假数据打底**——新用户第一次打开看到别人的
 * 公司名，会以为账号窜了。见 docs/产品完整性清单.md §2.1。
 */
const SEED: BoardData = {
  interviews: [],
  subCalendars: [],
  order: [],
  manualOrder: false,
  prepSnoozeUntil: {},
  filterCalendarId: null,
};

export const useInterviewStore = create<InterviewState>()(
  persist(
    (set, get) => ({
      ...SEED,
      hydrated: false,
      markHydrated: () => set({ hydrated: true }),

      setOrder: (order) => set({ order, manualOrder: true }),
      nudge: (id, delta) => set((s) => R.nudge(s, id, delta) ?? {}),
      setStatus: (id, status, now) => set((s) => R.setStatus(s, id, status, now)),
      resortByPriority: (now) =>
        set((s) => ({
          order: sortByPriority(s.interviews, now).map((i) => i.id),
          manualOrder: false,
        })),
      snoozePrep: (id, now) =>
        set((s) => ({
          prepSnoozeUntil: { ...s.prepSnoozeUntil, [id]: now + PREP_SNOOZE_MS },
        })),
      setFilter: (calendarId) => set({ filterCalendarId: calendarId }),

      addInterview: (input, now) => {
        const id = R.newId("itv");
        set((s) => R.addInterview(s, { ...input, id }, now));
        return id;
      },
      updateInterview: (id, patch, now) =>
        set((s) => R.updateInterview(s, id, patch, now)),
      removeInterview: (id) => set((s) => R.removeInterview(s, id)),

      importInterviews: (items, now) => {
        const existing = new Set(
          get().interviews.map((i) => i.externalId).filter(Boolean),
        );
        let added = 0;
        for (const item of items) {
          // 同一封邀请重复导入不应该产生两张卡
          if (item.externalId && existing.has(item.externalId)) continue;
          if (item.externalId) existing.add(item.externalId);
          set((s) => R.addInterview(s, { ...item, id: R.newId("itv") }, now));
          added += 1;
        }
        return added;
      },

      syncLedgerInterviews: (items, now) =>
        set((s) => R.syncLedgerInterviews(s, items, now)),

      applyBackup: (payload) =>
        set({
          ...payload,
          // 导入的数据里没有折叠静默期，重置掉免得沿用上一份的时间戳
          prepSnoozeUntil: {},
          filterCalendarId: null,
        }),

      createSubCalendar: ({ name, color }) => {
        const id = R.newId("cal");
        set((s) => ({
          subCalendars: [...s.subCalendars, { id, name, color, description: null }],
        }));
        return id;
      },
      updateSubCalendar: (id, patch) =>
        set((s) => ({
          subCalendars: s.subCalendars.map((cal) =>
            cal.id === id ? { ...cal, ...patch } : cal,
          ),
        })),
      deleteSubCalendar: (id, deletion) =>
        set((s) => R.deleteSubCalendar(s, id, deletion)),

      /**
       * 把演示卡片挪到「25 分钟后」。用户删掉它之后就是 no-op，
       * 不会在真实数据里凭空冒出来。
       */
      activateImminentDemo: (now) =>
        set((s) => {
          const target = s.interviews.find((i) => i.id === IMMINENT_DEMO_ID);
          if (!target) return {};
          const startUtc = new Date(now + 25 * 60_000).toISOString();
          if (target.startUtc === startUtc) return {};
          const interviews = s.interviews.map((item) =>
            item.id === IMMINENT_DEMO_ID
              ? {
                  ...item,
                  startUtc,
                  endUtc: new Date(now + 70 * 60_000).toISOString(),
                }
              : item,
          );
          return {
            interviews,
            order: s.manualOrder
              ? s.order
              : sortByPriority(interviews, now).map((i) => i.id),
          };
        }),

      ensureSubCalendar: (calendar) =>
        set((s) =>
          s.subCalendars.some((c) => c.id === calendar.id)
            ? {}
            : { subCalendars: [...s.subCalendars, calendar] },
        ),

      seedDemoData: (now) =>
        set({
          interviews: MOCK_INTERVIEWS,
          subCalendars: MOCK_SUB_CALENDARS,
          order: sortByPriority(MOCK_INTERVIEWS, now).map((i) => i.id),
          manualOrder: false,
        }),
    }),
    {
      name: "jcc-board",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      /**
       * skipHydration + 手动 rehydrate：localStorage 在服务端读不到，
       * 若让 persist 在建 store 时同步读回，客户端首帧就会和 SSR 不一致。
       * 改为挂载后再读，配合 hydrated 标记先渲染骨架。
       */
      skipHydration: true,
      partialize: (state): BoardData => ({
        interviews: state.interviews,
        subCalendars: state.subCalendars,
        order: state.order,
        manualOrder: state.manualOrder,
        prepSnoozeUntil: state.prepSnoozeUntil,
        filterCalendarId: state.filterCalendarId,
      }),
      // 无论有没有旧数据，读完都要放行渲染；出错也不能把界面卡在骨架上
      onRehydrateStorage: () => (state) => {
        (state ?? useInterviewStore.getState()).markHydrated();
      },
    },
  ),
);
