"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { DESTINATION_LABEL, DUE_LABEL, timeSummary } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";

/**
 * 日程卡。只放三样：**公司、岗位、时间**，外加一个说明是什么事的标签。
 * 其余一切（原文、时区换算、判断依据）都在「详情」里——卡片是用来扫的，不是用来读的。
 */
export function EventCard({
  result,
  viewerTimeZone,
  onDetail,
  pending = result.destination === "pending",
  note,
  actions,
  showAccess = false,
  done = null,
  personalNote = null,
  selection = null,
}: {
  result: DemoResult;
  viewerTimeZone: string;
  onDetail: () => void;
  /** 这张卡是不是还在等用户确认。默认按系统的判断；叠加了用户决定的地方由调用方传。 */
  pending?: boolean;
  /** 卡片来历的一句小字：「手动添加」「你确认的」。 */
  note?: string;
  /** 详情按钮左边的操作按钮。 */
  actions?: React.ReactNode;
  /** 把入口链接、考试码、会议号直接放在卡片上（日程里要用的卡）。 */
  showAccess?: boolean;
  /** 已经做完 / 没参加：卡片变淡，标出来。 */
  done?: "done" | "missed" | null;
  /** 你写的备注，卡片上露两行。 */
  personalNote?: string | null;
  /** 可勾选（批量操作）。 */
  selection?: { checked: boolean; onToggle: () => void } | null;
}) {
  const company = result.displayCompany.length > 0 ? result.displayCompany : "公司未认出";
  const time = timeSummary(result, viewerTimeZone);
  return (
    <div
      className={`flex flex-col rounded-xl border border-hairline p-4 ${done ? "bg-raised" : "bg-surface"}`}
      data-event-card
      data-destination={result.destination}
      data-done={done ?? undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        {selection ? (
          <input
            type="checkbox"
            checked={selection.checked}
            onChange={selection.onToggle}
            aria-label={`选中${company}这件事`}
            data-select-card
            className="mr-0.5"
          />
        ) : null}
        <KindChip result={result} />
        {done ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-offer-soft px-2 py-1 text-xs font-medium text-on-offer-soft">
            {done === "done" ? <Check size={12} aria-hidden /> : null}
            {done === "done" ? "已完成" : "没参加"}
          </span>
        ) : null}
        {pending ? (
          <span className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-on-accent">
            {DESTINATION_LABEL.pending}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-lg leading-snug font-semibold break-words text-ink">{company}</p>
      <p className="mt-0.5 text-sm break-words text-ink-soft">{result.role ?? "岗位未写明"}</p>

      <p className="tabular mt-3 text-base font-semibold text-ink">
        {time.text}
        {time.zone ? <span className="ml-2 text-xs font-normal text-ink-faint">{time.zone}</span> : null}
      </p>

      {note ? <p className="mt-1 text-xs leading-relaxed text-ink-faint">{note}</p> : null}

      {personalNote ? (
        <p className="mt-2 line-clamp-2 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap text-ink" title={personalNote}>
          {personalNote}
        </p>
      ) : null}

      {showAccess && !done ? <AccessStrip result={result} /> : null}

      <div className="mt-auto pt-3">
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-2.5">
          {actions}
          <DetailButton onClick={onDetail} label={`${company}的详情`} />
        </div>
      </div>
    </div>
  );
}

/**
 * 卡片上的入口：链接一键打开，考试码 / 会议号一键复制。
 * 都是规则从邮件原文逐字摘出的（详情里有完整列表和来历），这里最多各放两个，卡片不至于变长。
 */
function AccessStrip({ result }: { result: DemoResult }) {
  const links = result.links.slice(0, 2);
  const credentials = result.credentials.slice(0, 2);
  if (links.length === 0 && credentials.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5" data-card-access>
      {links.map((link, i) => (
        <a
          key={link}
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm font-medium text-on-brand-soft underline underline-offset-2"
          title={link}
        >
          <ExternalLink size={14} aria-hidden />
          {i === 0 ? "打开入口链接" : "其他链接"}
          <span className="min-w-0 truncate text-xs font-normal text-ink-faint no-underline">{hostOf(link)}</span>
        </a>
      ))}
      {credentials.map((credential) => (
        <CopyRow key={credential.value} label={credential.label} value={credential.value} />
      ))}
    </div>
  );
}

function hostOf(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return "";
  }
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    // 剪贴板在部分浏览器里会被拒绝；失败时什么都不显示，值本身可以手动选中
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="shrink-0 text-xs text-ink-faint">{label}</span>
      <code className="min-w-0 truncate font-mono text-[13px] text-ink select-all">{value}</code>
      <button type="button" onClick={copy} aria-label={`复制${label}`} className="shrink-0 rounded-lg p-1 text-ink-soft hover:bg-raised">
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}

/** 「这是什么事」的标签：形式（笔试 / 电话面试…）加上时间性质（准点开始 / 截止前完成）。 */
export function KindChip({ result }: { result: DemoResult }) {
  return (
    <>
      <span className="rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-semibold text-on-brand-soft">
        {result.kindLabel}
      </span>
      {result.dueType === "fixed_start" || result.dueType === "deadline" ? (
        <span className="rounded-lg bg-raised px-2 py-1 text-xs text-ink-soft">
          {DUE_LABEL[result.dueType]}
        </span>
      ) : null}
    </>
  );
}

/** 卡片和表格里的次要操作按钮。 */
export function ActionButton({
  onClick,
  children,
  label,
  tone = "plain",
  action,
}: {
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
  tone?: "plain" | "primary" | "danger";
  /** 给端到端测试用的标记。 */
  action?: string;
}) {
  const style =
    tone === "primary"
      ? "bg-brand-soft font-semibold text-on-brand-soft hover:opacity-85"
      : tone === "danger"
        ? "bg-drop-soft font-medium text-on-drop-soft hover:opacity-85"
        : "border border-hairline text-ink-soft hover:bg-raised hover:text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-action={action}
      className={`rounded-lg px-3 py-1 text-xs ${style}`}
    >
      {children}
    </button>
  );
}

/**
 * 要点两下的按钮：第一下变成「确认…」，4 秒内再点才执行。给撤不回来的操作用（彻底删除、清空所有修改、删除手动添加的记录）。
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmText,
  label,
  action,
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  confirmText: string;
  label?: string;
  action?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return armed ? (
    <ActionButton
      onClick={() => {
        setArmed(false);
        onConfirm();
      }}
      tone="danger"
      {...(label ? { label: `确认：${label}` } : {})}
      {...(action ? { action: `${action}-confirm` } : {})}
    >
      {confirmText}
    </ActionButton>
  ) : (
    <ActionButton onClick={() => setArmed(true)} {...(label ? { label } : {})} {...(action ? { action } : {})}>
      {children}
    </ActionButton>
  );
}

export function DetailButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-detail-button
      className="rounded-lg border border-hairline px-3 py-1 text-xs font-medium text-ink-soft hover:bg-raised hover:text-ink"
    >
      详情
    </button>
  );
}
