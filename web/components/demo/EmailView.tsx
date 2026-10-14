"use client";

import { useState } from "react";
import { ArrowDownUp, ChevronDown } from "lucide-react";
import { ActionButton, ConfirmButton, DetailButton, KindChip } from "@/components/demo/EventCard";
import { DESTINATION_LABEL, formatWallClock, timeSummary } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";
import type { SampleEmail } from "@/lib/demo/sampleEmails";

/**
 * 「邮件」视图：一封一行。和日程卡一样只突出公司、岗位、时间；
 * 原文与判断依据在「详情」里。
 *
 * 与「日程」的区别：这里是**逐封**的——催办和原通知各占一行，被忽略的验证码也在；
 * 日程是合并之后的「一件事一条」。
 *
 * 按**收到的时间**排，默认最新在前（作者 10/13 改定），可以一键切成最早在前。
 * 每行都写出收到的时刻——右边那个时间是信里说的「什么时候考 / 面」，不是收信时间，两者别混。
 */
export interface EmailActions {
  /** 「这是广告」：屏蔽这些信的发件人（私人看板才有）。 */
  onBlock?: (sampleIds: readonly string[]) => void;
  /** 删除：进回收站，可以恢复。 */
  onDelete: (sampleIds: readonly string[]) => void;
  onRestore: (sampleIds: readonly string[]) => void;
  /** 彻底删除：连原文一起从云端删掉，撤不回来（私人看板才有）。 */
  onPurge?: (sampleIds: readonly string[]) => void;
}

export function EmailView({
  samples,
  trashed = [],
  results,
  viewerTimeZone,
  onDetail,
  actions,
}: {
  samples: readonly SampleEmail[];
  /** 回收站里的信。 */
  trashed?: readonly SampleEmail[];
  results: ReadonlyMap<string, DemoResult>;
  viewerTimeZone: string;
  onDetail: (sampleId: string) => void;
  actions: EmailActions;
}) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [showIgnored, setShowIgnored] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  /** 勾选的信（批量「这是广告」/ 删除）。 */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const ordered = [...samples].sort((a, b) => {
    const diff = Date.parse(a.raw.receivedAtUtc) - Date.parse(b.raw.receivedAtUtc);
    return newestFirst ? -diff : diff;
  });
  // 广告、验证码、你自己发的、你屏蔽的……收在下面，默认折叠：一眼看到的应该只有求职相关的信
  const isIgnored = (r: DemoResult) => r.destination === "dropped" || r.destination === "noise";
  const relevant = ordered.filter((s) => {
    const r = results.get(s.id);
    return r !== undefined && !isIgnored(r);
  });
  const ignored = ordered.filter((s) => {
    const r = results.get(s.id);
    return r !== undefined && isIgnored(r);
  });
  // 勾选只对还在列表里的信有效（删掉、屏蔽之后自动不算）
  const live = new Set(samples.map((s) => s.id));
  const picked = [...selected].filter((id) => live.has(id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clear = () => setSelected(new Set());

  const row = (sample: SampleEmail) => {
    const result = results.get(sample.id);
    if (!result) return null;
    const company = result.displayCompany.length > 0 ? result.displayCompany : sample.raw.subject;
    return (
      <li key={sample.id} data-email-row={sample.id} className="flex items-start gap-3 rounded-xl border border-hairline bg-surface px-4 py-3">
        <input
          type="checkbox"
          checked={selected.has(sample.id)}
          onChange={() => toggle(sample.id)}
          aria-label={`选中「${sample.raw.subject}」`}
          className="mt-1.5 shrink-0"
          data-select-email={sample.id}
        />
        <div className="min-w-0 flex-1">
          {isIgnored(result) ? (
            <IgnoredRow sample={sample} label={ignoredLabel(result)} viewerTimeZone={viewerTimeZone} />
          ) : (
            <ParsedRow sample={sample} result={result} viewerTimeZone={viewerTimeZone} />
          )}
          <div className="mt-2 flex flex-wrap justify-end gap-1.5">
            {actions.onBlock && !isIgnored(result) ? (
              <ActionButton onClick={() => actions.onBlock?.([sample.id])} action="block-sender" label={`把「${sample.raw.subject}」的发件人标成广告`}>
                这是广告
              </ActionButton>
            ) : null}
            <ActionButton onClick={() => actions.onDelete([sample.id])} action="delete-email" label={`删除「${sample.raw.subject}」`}>
              删除
            </ActionButton>
            <DetailButton onClick={() => onDetail(sample.id)} label={`${company}的详情`} />
          </div>
        </div>
      </li>
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">
          求职相关 {relevant.length} 封 · 按收到的时间排列 · {newestFirst ? "最新在前" : "最早在前"}
        </p>
        <button
          type="button"
          onClick={() => setNewestFirst((v) => !v)}
          data-action="toggle-email-order"
          className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1 text-xs text-ink-soft hover:bg-raised"
        >
          <ArrowDownUp size={13} aria-hidden />
          {newestFirst ? "改成最早在前" : "改成最新在前"}
        </button>
      </div>

      {picked.length > 0 ? (
        <BulkBar count={picked.length} onClear={clear}>
          {actions.onBlock ? (
            <ActionButton
              onClick={() => {
                actions.onBlock?.(picked);
                clear();
              }}
              action="bulk-block"
            >
              这是广告
            </ActionButton>
          ) : null}
          <ActionButton
            onClick={() => {
              actions.onDelete(picked);
              clear();
            }}
            action="bulk-delete"
          >
            删除
          </ActionButton>
        </BulkBar>
      ) : null}

      <ul className="space-y-2" aria-label="求职相关的邮件">
        {relevant.map(row)}
      </ul>
      {relevant.length === 0 ? <p className="text-sm text-ink-faint">还没有求职相关的邮件。</p> : null}

      {ignored.length > 0 ? (
        <section className="mt-6 border-t border-hairline pt-4" aria-label="已忽略">
          <button
            type="button"
            onClick={() => setShowIgnored((v) => !v)}
            aria-expanded={showIgnored}
            data-action="toggle-ignored"
            className="flex items-center gap-1.5 text-sm font-semibold text-ink"
          >
            <ChevronDown size={15} aria-hidden className={showIgnored ? "" : "-rotate-90"} />
            已忽略（广告、验证码、你自己发的…）
            <span className="tabular text-xs font-normal text-ink-faint">{ignored.length}</span>
          </button>
          {showIgnored ? <ul className="mt-3 space-y-2">{ignored.map(row)}</ul> : null}
        </section>
      ) : null}

      {trashed.length > 0 ? (
        <section className="mt-6 border-t border-hairline pt-4" aria-label="回收站">
          <button
            type="button"
            onClick={() => setShowTrash((v) => !v)}
            aria-expanded={showTrash}
            data-action="toggle-trash"
            className="flex items-center gap-1.5 text-sm font-semibold text-ink"
          >
            <ChevronDown size={15} aria-hidden className={showTrash ? "" : "-rotate-90"} />
            回收站
            <span className="tabular text-xs font-normal text-ink-faint">{trashed.length}</span>
          </button>
          {showTrash ? (
            <>
              <p className="mt-1 text-xs text-ink-faint">
                删掉的信不参与任何推断。「恢复」放回原处；{actions.onPurge ? "「彻底删除」连原文一起从云端删掉，撤不回来。" : "演示站只能恢复。"}
              </p>
              <ul className="mt-3 space-y-2">
                {trashed.map((sample) => (
                  <li key={sample.id} data-trash-row={sample.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-hairline bg-raised px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink-soft">{sample.raw.subject}</p>
                      <ReceivedAt utc={sample.raw.receivedAtUtc} viewerTimeZone={viewerTimeZone} />
                    </div>
                    <div className="flex gap-1.5">
                      <ActionButton onClick={() => actions.onRestore([sample.id])} action="restore-email">
                        恢复
                      </ActionButton>
                      {actions.onPurge ? (
                        <ConfirmButton onConfirm={() => actions.onPurge?.([sample.id])} confirmText="确认彻底删除" action="purge-email" label={`彻底删除「${sample.raw.subject}」`}>
                          彻底删除
                        </ConfirmButton>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** 勾选了几项时出现的操作条。 */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: React.ReactNode }) {
  return (
    <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-brand-soft px-4 py-2.5 shadow-card" data-bulk-bar>
      <span className="text-sm font-medium text-on-brand-soft">已选 {count} 项</span>
      <div className="ml-auto flex flex-wrap gap-1.5">
        {children}
        <ActionButton onClick={onClear} action="bulk-clear">
          取消选择
        </ActionButton>
      </div>
    </div>
  );
}

/** 「收到 10月12日 周一 00:18」——按看的人所在时区。 */
function ReceivedAt({ utc, viewerTimeZone }: { utc: string; viewerTimeZone: string }) {
  if (Number.isNaN(Date.parse(utc))) return null;
  return <span className="tabular mt-0.5 block text-xs text-ink-faint">收到 {formatWallClock(utc, viewerTimeZone)}</span>;
}

function ignoredLabel(result: DemoResult): string {
  const label = result.trace[0]?.label;
  if (label === "你发出的信") return "你发出的";
  if (label === "处理出错") return "处理出错";
  if (label === "你屏蔽的发件人") return "你标成了广告";
  if (result.destination === "noise") return "广告 / 群发";
  return DESTINATION_LABEL.dropped;
}

function ParsedRow({ sample, result, viewerTimeZone }: { sample: SampleEmail; result: DemoResult; viewerTimeZone: string }) {
  const company = result.displayCompany.length > 0 ? result.displayCompany : "公司未认出";
  const time = timeSummary(result, viewerTimeZone);
  return (
    <div className="grid items-start gap-x-4 gap-y-2 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <KindChip result={result} />
          {result.destination === "pending" ? (
            <span className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-on-accent">
              {DESTINATION_LABEL.pending}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-base font-semibold break-words text-ink">
          {company}
          <span className="font-normal text-ink-soft"> · {result.role ?? "岗位未写明"}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-faint">{sample.raw.subject}</p>
        <ReceivedAt utc={sample.raw.receivedAtUtc} viewerTimeZone={viewerTimeZone} />
      </div>
      <p className="tabular text-sm font-semibold text-ink sm:text-right">
        {time.text}
        {time.zone ? <span className="block text-xs font-normal text-ink-faint">{time.zone}</span> : null}
      </p>
    </div>
  );
}

function IgnoredRow({ sample, label, viewerTimeZone }: { sample: SampleEmail; label: string; viewerTimeZone: string }) {
  return (
    <div className="min-w-0">
      <span className="rounded-lg bg-raised px-2 py-1 text-xs text-ink-soft">{label}</span>
      <p className="mt-2 truncate text-sm text-ink-soft">{sample.raw.subject}</p>
      <ReceivedAt utc={sample.raw.receivedAtUtc} viewerTimeZone={viewerTimeZone} />
    </div>
  );
}
