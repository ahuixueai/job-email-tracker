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
}) {
  const company = result.displayCompany.length > 0 ? result.displayCompany : "公司未认出";
  const time = timeSummary(result, viewerTimeZone);
  return (
    <div
      className="flex flex-col rounded-xl border border-hairline bg-surface p-4"
      data-event-card
      data-destination={result.destination}
    >
      <div className="flex flex-wrap items-center gap-2">
        <KindChip result={result} />
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

      <div className="mt-auto pt-3">
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-2.5">
          {actions}
          <DetailButton onClick={onDetail} label={`${company}的详情`} />
        </div>
      </div>
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
