"use client";

import { useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { BulkBar } from "@/components/demo/EmailView";
import { ActionButton, ConfirmButton, EventCard } from "@/components/demo/EventCard";
import { phaseOf } from "@/lib/demo/agenda";
import type { AgendaItem } from "@/lib/demo/agenda";
import { pendingReason } from "@/lib/demo/parseDemo";

/** 日程和待确认两个视图都要用的那几个动作。 */
export interface AgendaActions {
  onDetail: (item: AgendaItem) => void;
  /** 打开「放进日程」表单。 */
  onConfirm: (item: AgendaItem) => void;
  /** 只记到投递表，不上日程。 */
  onTrack: (item: AgendaItem) => void;
  /** 与求职无关。可以一次好几件（待确认里勾选后批量）。 */
  onIgnore: (items: readonly AgendaItem[]) => void;
  /** 从日程移出（邮件解析出来的事）或删除（手动加的事）。 */
  onRemove: (item: AgendaItem) => void;
  /** 撤销用户对它的处理。 */
  onUndo: (item: AgendaItem) => void;
  /** 打开「添加日程」表单。传日期时预填那一天。 */
  onAdd: (dateKey?: string) => void;
  /** 标「完成」或「没参加」。 */
  onComplete: (item: AgendaItem, state: "done" | "missed") => void;
  /** 撤销「完成 / 没参加」，回到原来的位置。 */
  onUncomplete: (item: AgendaItem) => void;
  /** 打开「编辑」表单。 */
  onEdit: (item: AgendaItem) => void;
  /** 「这是广告」：屏蔽这些事来自的发件人。没有时不显示按钮（演示站）。 */
  onBlock?: (items: readonly AgendaItem[]) => void;
}

export function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-action="add"
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-soft px-3 py-1.5 text-sm font-semibold text-on-brand-soft hover:opacity-85"
    >
      <Plus size={15} aria-hidden />
      {children}
    </button>
  );
}

function noteOf(item: AgendaItem): string | undefined {
  const base = originNote(item);
  if (item.editedFields.length === 0) return base;
  return [base, `你改过${item.editedFields.join("、")}`].filter(Boolean).join(" · ");
}

function originNote(item: AgendaItem): string | undefined {
  if (item.origin === "manual") return "手动添加";
  if (item.decision?.action === "confirm") return "你确认后排进来的";
  return undefined;
}

/**
 * 日程卡上的「移出 / 删除」。
 * 邮件解析出来的事是「移出日程」——随时能在「待确认 → 已处理」里撤销，所以一点就走；
 * 手动加的事是真删除、找不回来，所以要点两下。
 */
export function RemoveButton({ item, onRemove }: { item: AgendaItem; onRemove: (item: AgendaItem) => void }) {
  const company = item.result.displayCompany;
  if (item.origin !== "manual") {
    return (
      <ActionButton onClick={() => onRemove(item)} label={`把${company}这件事移出日程`} action="remove">
        移出日程
      </ActionButton>
    );
  }
  return (
    <ConfirmButton onConfirm={() => onRemove(item)} confirmText="确认删除" label={`删除${company}这条日程`} action="remove">
      删除
    </ConfirmButton>
  );
}

/**
 * 「日程」视图：一件事一张卡。
 *
 * 还没做的按「要准点到 / 截止前完成 / 没有具体时间」分组——这三类要你做的事不一样。
 * 时间已经过了、你还没说做没做的，单独放「做了吗？」：**不替你算完成**，可能是错过了。
 * 做完的折叠在最下面，随时能撤销。
 */
export function AgendaView({
  items,
  viewerTimeZone,
  nowMs,
  actions,
}: {
  items: readonly AgendaItem[];
  viewerTimeZone: string;
  nowMs: number;
  actions: AgendaActions;
}) {
  const board = items.filter((item) => item.place === "board");
  const active = board.filter((item) => phaseOf(item, nowMs) === "active");
  const overdue = board.filter((item) => phaseOf(item, nowMs) === "overdue");
  const done = board.filter((item) => phaseOf(item, nowMs) === "done");
  const groups: readonly { title: string; items: AgendaItem[] }[] = [
    { title: "要准点到", items: active.filter((item) => item.result.dueType === "fixed_start") },
    { title: "截止前完成", items: active.filter((item) => item.result.dueType === "deadline") },
    {
      title: "没有具体时间",
      items: active.filter(
        (item) => item.result.dueType !== "fixed_start" && item.result.dueType !== "deadline",
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">需要你在某个时候去做的事。回执和结果通知记在「投递」里。</p>
        <AddButton onClick={() => actions.onAdd()}>添加日程</AddButton>
      </div>
      {board.length === 0 ? (
        <p className="mt-6 text-sm text-ink-faint">还没有排进日程的安排。</p>
      ) : (
        <div className="mt-5 space-y-7">
          <OverdueSection items={overdue} viewerTimeZone={viewerTimeZone} actions={actions} />
          {active.length === 0 ? <p className="text-sm text-ink-faint">接下来没有要做的事。</p> : null}
          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section key={group.title} aria-label={group.title} data-agenda-group={group.title}>
                <h2 className="text-sm font-semibold text-ink">
                  {group.title}
                  <span className="tabular ml-2 text-xs font-normal text-ink-faint">{group.items.length}</span>
                </h2>
                <CardGrid items={group.items} viewerTimeZone={viewerTimeZone} actions={actions} />
              </section>
            ))}
          <DoneSection items={done} viewerTimeZone={viewerTimeZone} actions={actions} />
        </div>
      )}
    </div>
  );
}

/** 「已过时间，做了吗？」——日程和「今天」都用。 */
export function OverdueSection({
  items,
  viewerTimeZone,
  actions,
}: {
  items: readonly AgendaItem[];
  viewerTimeZone: string;
  actions: AgendaActions;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label="已过时间，做了吗？" data-agenda-group="overdue">
      <h2 className="text-sm font-semibold text-ink">
        已过时间，做了吗？
        <span className="tabular ml-2 text-xs font-normal text-ink-faint">{items.length}</span>
      </h2>
      <p className="mt-1 text-xs text-ink-faint">时间过了不会自动算完成——可能是错过了。点一下告诉看板。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...items].reverse().map((item) => (
          <EventCard
            key={item.key}
            result={item.result}
            viewerTimeZone={viewerTimeZone}
            pending={false}
            note={noteOf(item)}
            onDetail={() => actions.onDetail(item)}
            actions={
              <>
                <ActionButton onClick={() => actions.onComplete(item, "done")} tone="primary" action="complete">
                  完成
                </ActionButton>
                <ActionButton onClick={() => actions.onComplete(item, "missed")} action="missed">
                  没参加
                </ActionButton>
              </>
            }
          />
        ))}
      </div>
    </section>
  );
}

/** 做完的事：默认折叠，只露出数量；展开后每件都能撤销。最近做完的在前。 */
function DoneSection({
  items,
  viewerTimeZone,
  actions,
}: {
  items: readonly AgendaItem[];
  viewerTimeZone: string;
  actions: AgendaActions;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const ordered = [...items].sort((a, b) => (b.completion?.atMs ?? 0) - (a.completion?.atMs ?? 0));
  return (
    <section aria-label="已完成" data-agenda-group="done" className="border-t border-hairline pt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-action="toggle-done"
        className="flex items-center gap-1.5 text-sm font-semibold text-ink"
      >
        <ChevronDown size={15} aria-hidden className={open ? "" : "-rotate-90"} />
        已完成
        <span className="tabular text-xs font-normal text-ink-faint">{items.length}</span>
      </button>
      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map((item) => (
            <EventCard
              key={item.key}
              result={item.result}
              viewerTimeZone={viewerTimeZone}
              pending={false}
              done={item.completion?.state ?? null}
              onDetail={() => actions.onDetail(item)}
              actions={
                <ActionButton onClick={() => actions.onUncomplete(item)} action="uncomplete">
                  撤销
                </ActionButton>
              }
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

const DECISION_LABEL: Readonly<Record<string, string>> = {
  confirm: "已放进日程",
  track: "只记到投递表",
  remove: "已移出日程",
  ignore: "已忽略",
};

/**
 * 「待确认」视图：系统拿不准、没有擅自排进日程的事，每件都由你决定去向。
 * 处理过的收在下面，随时可以撤销——撤销后它回到系统原本放的位置。
 */
export function PendingView({
  items,
  viewerTimeZone,
  actions,
}: {
  items: readonly AgendaItem[];
  viewerTimeZone: string;
  actions: AgendaActions;
}) {
  const pending = items.filter((item) => item.place === "pending");
  const handled = items.filter((item) => item.origin !== "manual" && item.decision !== null);
  /** 勾选的待确认（批量忽略 / 这是广告）。处理掉的自动不算。 */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const picked = pending.filter((item) => selected.has(item.id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clear = () => setSelected(new Set());
  return (
    <div>
      {pending.length === 0 ? (
        <p className="text-sm text-ink-faint">没有需要你确认的事。</p>
      ) : (
        <>
          <p className="max-w-2xl text-sm leading-relaxed text-ink-soft">
            这些事有关键信息拿不准，系统没有替你猜一个排进日程。由你决定放到哪里；为什么拿不准写在每张卡上。
          </p>
          {picked.length > 0 ? (
            <div className="mt-3">
              <BulkBar count={picked.length} onClear={clear}>
                <ActionButton
                  onClick={() => {
                    actions.onIgnore(picked);
                    clear();
                  }}
                  action="bulk-ignore"
                >
                  忽略
                </ActionButton>
                {actions.onBlock ? (
                  <ActionButton
                    onClick={() => {
                      actions.onBlock?.(picked.filter((item) => item.origin === "email"));
                      clear();
                    }}
                    action="bulk-block"
                  >
                    这是广告
                  </ActionButton>
                ) : null}
              </BulkBar>
            </div>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pending.map((item) => (
              <EventCard
                key={item.key}
                result={item.result}
                viewerTimeZone={viewerTimeZone}
                pending
                note={`为什么拿不准：${pendingReason(item.result)}`}
                selection={{ checked: selected.has(item.id), onToggle: () => toggle(item.id) }}
                onDetail={() => actions.onDetail(item)}
                actions={
                  <>
                    <ActionButton onClick={() => actions.onConfirm(item)} tone="primary" action="confirm">
                      放进日程
                    </ActionButton>
                    <ActionButton onClick={() => actions.onTrack(item)} action="track">
                      只记到投递表
                    </ActionButton>
                    <ActionButton onClick={() => actions.onIgnore([item])} action="ignore">
                      忽略
                    </ActionButton>
                    {actions.onBlock && item.origin === "email" ? (
                      <ActionButton onClick={() => actions.onBlock?.([item])} action="block-sender" label="这是广告：以后这个发件人的信都不再显示">
                        这是广告
                      </ActionButton>
                    ) : null}
                  </>
                }
              />
            ))}
          </div>
        </>
      )}

      {handled.length > 0 ? (
        <section className="mt-8" aria-label="已处理" data-handled>
          <h2 className="text-sm font-semibold text-ink">
            已处理
            <span className="tabular ml-2 text-xs font-normal text-ink-faint">{handled.length}</span>
          </h2>
          <ul className="mt-3 space-y-2">
            {handled.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-hairline bg-surface px-4 py-2.5 text-sm"
              >
                <span className="rounded-lg bg-raised px-2 py-0.5 text-xs text-ink-soft">
                  {DECISION_LABEL[item.decision?.action ?? ""] ?? ""}
                </span>
                <span className="min-w-0 flex-1 break-words text-ink">
                  {item.result.displayCompany.length > 0 ? item.result.displayCompany : "公司未认出"}
                  <span className="text-ink-soft"> · {item.result.kindLabel}</span>
                </span>
                <ActionButton onClick={() => actions.onUndo(item)} action="undo">
                  撤销
                </ActionButton>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function CardGrid({
  items,
  viewerTimeZone,
  actions,
}: {
  items: readonly AgendaItem[];
  viewerTimeZone: string;
  actions: AgendaActions;
}) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <EventCard
          key={item.key}
          result={item.result}
          viewerTimeZone={viewerTimeZone}
          pending={false}
          note={noteOf(item)}
          showAccess
          done={item.completion?.state ?? null}
          personalNote={item.note}
          onDetail={() => actions.onDetail(item)}
          actions={
            item.completion ? (
              <ActionButton onClick={() => actions.onUncomplete(item)} action="uncomplete">
                撤销完成
              </ActionButton>
            ) : (
              <>
                <CompleteButton item={item} onComplete={actions.onComplete} />
                <ActionButton onClick={() => actions.onEdit(item)} label={`编辑${item.result.displayCompany}这件事`} action="edit-item">
                  编辑
                </ActionButton>
                <RemoveButton item={item} onRemove={actions.onRemove} />
              </>
            )
          }
        />
      ))}
    </div>
  );
}

export function CompleteButton({
  item,
  onComplete,
}: {
  item: AgendaItem;
  onComplete: (item: AgendaItem, state: "done" | "missed") => void;
}) {
  const company = item.result.displayCompany;
  return (
    <button
      type="button"
      onClick={() => onComplete(item, "done")}
      aria-label={`把${company}这件事标为完成`}
      data-action="complete"
      className="inline-flex items-center gap-1 rounded-lg bg-brand-soft px-3 py-1 text-xs font-semibold text-on-brand-soft hover:opacity-85"
    >
      <Check size={13} aria-hidden />
      完成
    </button>
  );
}
