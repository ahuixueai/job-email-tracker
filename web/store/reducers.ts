import type { Interview, InterviewStatus, SubCalendar } from "@/types";
import { sortByPriority } from "@/lib/priority";

/** 删除子日历时对其名下面试的处置方式。 */
export type CalendarDeletion =
  | { kind: "migrate"; targetId: string }
  | { kind: "purge" };

/** store 里会被持久化的那部分状态。 */
export interface BoardData {
  interviews: Interview[];
  subCalendars: SubCalendar[];
  order: string[];
  manualOrder: boolean;
  prepSnoozeUntil: Record<string, number>;
  filterCalendarId: string | null;
}

/**
 * 纯函数 reducer：不碰 zustand，方便单测，也让 store 文件保持薄。
 *
 * 涉及排序的几个都把 now 作为参数收进来，内部一律不读 Date.now()——
 * 读挂钟的"纯函数"测不了，排序结果也就没法钉死。
 */

export function addInterview(
  state: BoardData,
  interview: Interview,
  now: number,
): Partial<BoardData> {
  const interviews = [...state.interviews, interview];
  return {
    interviews,
    // 没手动排过序就重新按优先级插进正确位置；排过就追加到末尾，尊重用户的顺序。
    order: state.manualOrder
      ? [...state.order, interview.id]
      : sortByPriority(interviews, now).map((i) => i.id),
  };
}

/**
 * 会改变优先级得分的字段。改到这几个里的任何一个，
 * 自动排序下的 order 就不再是当前优先级的真实反映，必须重排。
 *
 * importance 与 startUtc 直接进 calcPriority；status 决定终态是否沉底。
 */
const PRIORITY_FIELDS = ["startUtc", "importance", "status"] as const;

export function updateInterview(
  state: BoardData,
  id: string,
  patch: Partial<Omit<Interview, "id">>,
  now: number,
): Partial<BoardData> {
  const interviews = state.interviews.map((item) =>
    item.id === id ? { ...item, ...patch } : item,
  );

  // 手动排过序就不动：用户的顺序高于优先级。
  // 改的字段与优先级无关时也不动，免得列表无缘无故跳一下。
  const affectsPriority = PRIORITY_FIELDS.some((field) => field in patch);
  if (state.manualOrder || !affectsPriority) return { interviews };

  return {
    interviews,
    order: sortByPriority(interviews, now).map((i) => i.id),
  };
}

export function removeInterview(
  state: BoardData,
  id: string,
): Partial<BoardData> {
  const next = { ...state.prepSnoozeUntil };
  delete next[id];
  return {
    interviews: state.interviews.filter((item) => item.id !== id),
    order: state.order.filter((itemId) => itemId !== id),
    prepSnoozeUntil: next,
  };
}

/**
 * `ledger.db` 里那份数据说了算的字段。每次同步都按台账刷新。
 *
 * 反过来说，**不在这张表里的字段就是用户的**，同步一律不碰：
 * `status` 是左右滑手势写的，`importance` 是用户调的，`prep` 是用户填的备战信息，
 * `subCalendarId` 是用户归的类。`buildLedgerInterviews` 对这几个只吐常量占位
 * （`status: "scheduled"` / `importance: 3` / 空 prep），拿常量去覆盖不是「同步」，
 * 是把用户做过的操作抹掉——CLAUDE.md 铁律三，用户改过的字段一律盖不回去。
 *
 * 已知取舍：台账的 `next_action` 会进 `prep.jdNotes`，因为 prep 整体归用户，
 * 它在首次建卡之后就不再跟着台账变。要改这条得先有办法区分「用户填的」和
 * 「台账带来的」，那是 userPatch 那一套，不在本轮范围内。
 */
const LEDGER_OWNED_FIELDS = [
  "company",
  "position",
  "startUtc",
  "endUtc",
  "sourceTimeZone",
  "timePrecision",
  "sourceTimeZoneConfirmed",
  "type",
] as const satisfies readonly (keyof Interview)[];

function applyLedgerFields(card: Interview, fresh: Omit<Interview, "id">): Interview {
  const next = { ...card };
  for (const field of LEDGER_OWNED_FIELDS) {
    // 逐字段赋值而不是整体 spread：多出来的字段（status/importance/prep）必须留在用户这边
    (next[field] as Interview[typeof field]) = fresh[field];
  }
  return next;
}

/**
 * 把 `/api/interviews` 这一次读到的台账整体同步进看板：更新、新增、移除。
 *
 * 和 `importInterviews`（Google 日历用，只增不减）不同，这个是**替换语义**：
 * 台账里不再出现的记录，对应的卡片要消失。理由是 ledger.db 是唯一数据源，
 * 记录被关掉（状态不在 `LIVE_STATUS` 里）之后看板还留着它，显示的就是假的。
 *
 * 匹配键是 `externalId`（`ledger-<行号>`），不是卡片 id——已经同步过的卡片
 * 拿的是本地生成的 id，按 id 匹配会把它们全判成「新的」，每刷新一次翻一倍。
 *
 * 只动 `source === "ledger"` 的卡片，用户手工新建的和 Google 导入的一概不碰。
 */
export function syncLedgerInterviews(
  state: BoardData,
  incoming: readonly Omit<Interview, "id">[],
  now: number,
): Partial<BoardData> {
  const fresh = new Map<string, Omit<Interview, "id">>();
  for (const item of incoming) {
    // 没有稳定标识就没法匹配，收下它等于每次刷新都建一张新卡，宁可不收
    if (item.externalId) fresh.set(item.externalId, item);
  }

  const interviews: Interview[] = [];
  const removedIds: string[] = [];
  const matched = new Set<string>();

  for (const card of state.interviews) {
    const externalId = card.source === "ledger" ? card.externalId : null;
    if (!externalId) {
      interviews.push(card);
      continue;
    }
    const update = fresh.get(externalId);
    if (!update) {
      removedIds.push(card.id);
      continue;
    }
    matched.add(externalId);
    interviews.push(applyLedgerFields(card, update));
  }

  const addedIds: string[] = [];
  for (const [externalId, item] of fresh) {
    if (matched.has(externalId)) continue;
    const id = newId("itv");
    addedIds.push(id);
    interviews.push({ ...item, id });
  }

  const prepSnoozeUntil = { ...state.prepSnoozeUntil };
  for (const id of removedIds) delete prepSnoozeUntil[id];

  const removed = new Set(removedIds);
  const order = state.manualOrder
    ? [...state.order.filter((id) => !removed.has(id)), ...addedIds]
    : sortByPriority(interviews, now).map((i) => i.id);

  return { interviews, order, prepSnoozeUntil };
}

export function setStatus(
  state: BoardData,
  id: string,
  status: InterviewStatus,
  now: number,
): Partial<BoardData> {
  return updateInterview(state, id, { status }, now);
}

export function nudge(
  state: BoardData,
  id: string,
  delta: -1 | 1,
): Partial<BoardData> | null {
  const from = state.order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= state.order.length) return null;
  const next = [...state.order];
  [next[from], next[to]] = [next[to], next[from]];
  return { order: next, manualOrder: true };
}

export function deleteSubCalendar(
  state: BoardData,
  id: string,
  deletion: CalendarDeletion,
): Partial<BoardData> {
  const interviews =
    deletion.kind === "migrate"
      ? state.interviews.map((item) =>
          item.subCalendarId === id
            ? { ...item, subCalendarId: deletion.targetId }
            : item,
        )
      : state.interviews.filter((item) => item.subCalendarId !== id);
  const keptIds = new Set(interviews.map((i) => i.id));
  return {
    interviews,
    subCalendars: state.subCalendars.filter((cal) => cal.id !== id),
    order: state.order.filter((itemId) => keptIds.has(itemId)),
    filterCalendarId:
      state.filterCalendarId === id ? null : state.filterCalendarId,
  };
}

/**
 * 筛选视图下拖拽排序：Reorder 只知道可见的那几张，直接写回会把隐藏项抹掉。
 * 按「可见位置」逐个回填，隐藏项留在原本的绝对位置上。
 */
export function mergeVisibleOrder(
  fullOrder: readonly string[],
  visibleIds: readonly string[],
): string[] {
  const visibleSet = new Set(visibleIds);
  let cursor = 0;
  return fullOrder.map((id) =>
    visibleSet.has(id) ? (visibleIds[cursor++] ?? id) : id,
  );
}

/** 按当前 order 取出面试对象，过滤掉找不到的脏 id。 */
export function orderInterviews(
  interviews: readonly Interview[],
  order: readonly string[],
): Interview[] {
  const byId = new Map(interviews.map((i) => [i.id, i]));
  return order
    .map((id) => byId.get(id))
    .filter((i): i is Interview => Boolean(i));
}

/** 生成 id。crypto.randomUUID 在浏览器和 Node 19+ 都有，兜底用时间戳。 */
export function newId(prefix: string): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${uuid}`;
}
