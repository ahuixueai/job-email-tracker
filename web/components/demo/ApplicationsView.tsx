"use client";

import { Fragment, useId, useState, useSyncExternalStore } from "react";
import { AddButton } from "@/components/demo/AgendaView";
import { BulkBar } from "@/components/demo/EmailView";
import { ActionButton, ConfirmButton, DetailButton } from "@/components/demo/EventCard";
import { nextText, STAGE_LABEL, stageText } from "@/lib/demo/applications";
import type { ApplicationRow } from "@/lib/demo/applications";
import { dateKeyIn } from "@/lib/demo/agenda";
import { ROUNDS, STAGES } from "@/lib/demo/userEdits";
import type { ApplicationPatch, ManualApplication, Round, RowEdit, Stage } from "@/lib/demo/userEdits";

/** 状态标签的底色。文字始终写出状态名，颜色只是帮着扫。 */
const STAGE_STYLE: Readonly<Record<Stage, string>> = {
  applied: "bg-raised text-ink-soft",
  materials: "bg-accent-soft text-ink",
  assessment: "bg-brand-soft text-on-brand-soft",
  interview: "bg-accent text-on-accent",
  offer: "bg-offer-soft text-on-offer-soft",
  rejected: "bg-drop-soft text-on-drop-soft",
};

export function StageChip({ row }: { row: Pick<ApplicationRow, "stage" | "round"> }) {
  return (
    <span className={`inline-block rounded-lg px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${STAGE_STYLE[row.stage]}`}>
      {stageText(row)}
    </span>
  );
}

function shortDate(utc: string | null, viewerTimeZone: string): string {
  if (utc === null) return "—";
  const key = dateKeyIn(utc, viewerTimeZone);
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
}

export interface ApplicationActions {
  onDetail: (row: ApplicationRow) => void;
  /** 保存「编辑」：状态有变时带 patch，其余改动在 change 里（只含改了的字段）。 */
  onEdit: (row: ApplicationRow, patch: ApplicationPatch | null, change: RowEdit) => void;
  /** 恢复系统推断：状态和其他修改一起去掉。 */
  onRestore: (row: ApplicationRow) => void;
  /** 跟进：later = 已跟进，7 天后再看；stop = 不用再跟进（清掉跟进日期）。可以一次好几行。 */
  onFollowUp: (rows: readonly ApplicationRow[], mode: "later" | "stop") => void;
  onAdd: (application: Omit<ManualApplication, "id" | "createdAtMs">) => void;
  onRemove: (row: ApplicationRow) => void;
}

/**
 * 「投递」视图：一家公司一行，状态跟着邮件自动走。
 *
 * 对应飞书多维表格里的「已投递岗位」：公司、岗位、当前状态、工作地点、下一步。
 * 状态可以手动改——改过的那一行以你的为准，不会被后来的邮件悄悄改回去，
 * 旁边会标「手动」，并且可以一键恢复成系统推断的。
 */
export function ApplicationsView({
  rows,
  viewerTimeZone,
  actions,
  initialFilter = "all",
}: {
  rows: readonly ApplicationRow[];
  viewerTimeZone: string;
  actions: ApplicationActions;
  initialFilter?: Stage | "all" | "followup";
}) {
  const [filter, setFilter] = useState<Stage | "all" | "followup">(initialFilter);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const wide = useWide();
  /** 勾选的行（批量跟进）。 */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const shown =
    filter === "all" ? rows : filter === "followup" ? rows.filter((row) => row.followUpDue) : rows.filter((row) => row.stage === filter);
  const followUps = rows.filter((row) => row.followUpDue).length;
  const picked = rows.filter((row) => selected.has(row.key));
  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allShownPicked = shown.length > 0 && shown.every((row) => selected.has(row.key));
  const toggleAll = () => setSelected(allShownPicked ? new Set() : new Set(shown.map((row) => row.key)));
  const clear = () => setSelected(new Set());

  const chips: readonly { id: Stage | "all" | "followup"; label: string; count: number }[] = [
    { id: "all", label: "全部", count: rows.length },
    // 有跟进日期（你填的，或面试 / 测评完成后自动给的）才会有；没有就不显示这一项
    ...(followUps > 0 ? [{ id: "followup" as const, label: "该跟进了", count: followUps }] : []),
    ...STAGES.map((stage) => ({
      id: stage,
      label: STAGE_LABEL[stage],
      count: rows.filter((row) => row.stage === stage).length,
    })),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="按状态筛选">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              aria-pressed={filter === chip.id}
              data-stage-filter={chip.id}
              className={
                filter === chip.id
                  ? "rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-semibold text-on-brand-soft"
                  : "rounded-lg border border-hairline px-2.5 py-1 text-xs text-ink-soft hover:bg-raised"
              }
            >
              {chip.label}
              <span className="tabular ml-1.5">{chip.count}</span>
            </button>
          ))}
        </div>
        <AddButton onClick={() => setAdding(true)}>添加投递</AddButton>
      </div>

      {adding ? (
        <AddApplicationForm
          onCancel={() => setAdding(false)}
          onSubmit={(application) => {
            actions.onAdd(application);
            setAdding(false);
          }}
        />
      ) : null}

      {picked.length > 0 ? (
        <div className="mt-4">
          <BulkBar count={picked.length} onClear={clear}>
            <ActionButton
              onClick={() => {
                actions.onFollowUp(picked, "later");
                clear();
              }}
              action="bulk-follow-later"
            >
              已跟进，7 天后再看
            </ActionButton>
            <ActionButton
              onClick={() => {
                actions.onFollowUp(picked, "stop");
                clear();
              }}
              action="bulk-follow-stop"
            >
              不用再跟进
            </ActionButton>
          </BulkBar>
        </div>
      ) : null}

      {/* 手机上一家公司一张卡，不用左右拖表格；宽屏用表格。只渲染其中一种，免得同一行的编辑表单出现两份 */}
      {wide ? null : (
      <ul className="mt-4 space-y-2" aria-label="投递列表" data-applications-cards>
        {shown.length === 0 ? <li className="py-4 text-center text-sm text-ink-faint">这个状态下没有投递记录。</li> : null}
        {shown.map((row) => (
          <li key={row.key} className="rounded-xl border border-hairline bg-surface p-4" data-application-card={row.key}>
            <div className="flex items-start gap-3">
              <input type="checkbox" checked={selected.has(row.key)} onChange={() => toggle(row.key)} aria-label={`选中${row.company}`} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StageChip row={row} />
                  {(row.manualStage || row.edited) && row.origin !== "manual" ? <span className="text-xs text-ink-faint">你改过</span> : null}
                  {row.origin === "manual" ? <span className="text-xs text-ink-faint">手动添加</span> : null}
                </div>
                <p className="mt-2 text-base font-semibold break-words text-ink">{row.company}</p>
                <p className="text-sm break-words text-ink-soft">
                  {row.role ?? "岗位未写明"}
                  {row.location ? ` · ${row.location}` : ""}
                </p>
                <p className={`mt-2 text-sm ${row.followUpDue ? "font-medium text-ink" : "text-ink-soft"}`}>
                  下一步：{nextText(row, viewerTimeZone)}
                  {row.followUpDue ? <span className="ml-1 text-xs font-normal text-on-accent">（跟进日期已到）</span> : null}
                </p>
                {row.note ? <p className="mt-1 line-clamp-2 text-xs whitespace-pre-wrap text-ink-faint">备注：{row.note}</p> : null}
                <p className="tabular mt-1 text-xs text-ink-faint">
                  {shortDate(row.firstSeenUtc, viewerTimeZone)}
                  {row.lastSeenUtc !== row.firstSeenUtc ? ` → ${shortDate(row.lastSeenUtc, viewerTimeZone)}` : ""}
                  {row.emailIds.length > 0 ? ` · ${row.emailIds.length} 封邮件` : ""}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t border-hairline pt-2.5">
              <RowButtons row={row} editing={editing === row.key} onEdit={() => setEditing(row.key)} actions={actions} />
            </div>
            {editing === row.key ? (
              <div className="mt-3 rounded-xl bg-raised p-3">
                <RowEditor
                  row={row}
                  onCancel={() => setEditing(null)}
                  onSave={(patch, change) => {
                    actions.onEdit(row, patch, change);
                    setEditing(null);
                  }}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      )}

      {wide ? (
      <div className="mt-4 overflow-x-auto rounded-xl border border-hairline bg-surface">
        <table className="w-full min-w-[52rem] border-collapse text-left text-sm" data-applications-table>
          <thead>
            <tr className="border-b border-hairline text-xs text-ink-faint">
              <th scope="col" className="w-8 py-2.5 pl-4">
                <input type="checkbox" checked={allShownPicked} onChange={toggleAll} aria-label="全选当前列出的投递" data-select-all />
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">公司</th>
              <th scope="col" className="px-3 py-2.5 font-medium">岗位</th>
              <th scope="col" className="px-3 py-2.5 font-medium">当前状态</th>
              <th scope="col" className="px-3 py-2.5 font-medium">下一步</th>
              <th scope="col" className="px-3 py-2.5 font-medium">工作地点</th>
              <th scope="col" className="px-3 py-2.5 font-medium">最早 / 最近</th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-ink-faint">
                  这个状态下没有投递记录。
                </td>
              </tr>
            ) : null}
            {shown.map((row) => (
              <Fragment key={row.key}>
              <tr className="border-b border-hairline align-top last:border-b-0" data-application-row={row.key}>
                <td className="py-3 pl-4">
                  <input type="checkbox" checked={selected.has(row.key)} onChange={() => toggle(row.key)} aria-label={`选中${row.company}`} data-select-row={row.key} />
                </td>
                <th scope="row" className="px-3 py-3 font-semibold break-words text-ink">
                  {row.company}
                  {row.origin === "manual" ? (
                    <span className="mt-0.5 block text-xs font-normal text-ink-faint">手动添加</span>
                  ) : null}
                </th>
                <td className="px-3 py-3 break-words text-ink-soft">
                  {row.role ?? "未写明"}
                  {row.note ? (
                    <span className="mt-1 line-clamp-2 block text-xs whitespace-pre-wrap text-ink-faint" title={row.note}>
                      备注：{row.note}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StageChip row={row} />
                    {(row.manualStage || row.edited) && row.origin !== "manual" ? (
                      <span className="text-xs text-ink-faint">你改过</span>
                    ) : null}
                    {row.resultUnclear ? (
                      <span className="text-xs text-ink-faint">有结果通知，见详情</span>
                    ) : null}
                  </div>
                </td>
                <td className={`tabular px-3 py-3 ${row.followUpDue ? "font-medium text-ink" : "text-ink-soft"}`}>
                  {nextText(row, viewerTimeZone)}
                  {row.followUpDue ? <span className="block text-xs font-normal text-on-accent">跟进日期已到</span> : null}
                </td>
                <td className="px-3 py-3 break-words text-ink-soft">{row.location ?? "—"}</td>
                <td className="tabular px-3 py-3 whitespace-nowrap text-ink-soft">
                  {shortDate(row.firstSeenUtc, viewerTimeZone)}
                  {row.lastSeenUtc !== row.firstSeenUtc ? ` → ${shortDate(row.lastSeenUtc, viewerTimeZone)}` : ""}
                  {row.emailIds.length > 0 ? (
                    <span className="block text-xs text-ink-faint">{row.emailIds.length} 封邮件</span>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    <RowButtons row={row} editing={editing === row.key} onEdit={() => setEditing(row.key)} actions={actions} />
                  </div>
                </td>
              </tr>
              {editing === row.key ? (
                <tr className="border-b border-hairline bg-raised" data-row-editor={row.key}>
                  <td colSpan={8} className="px-4 py-4">
                    <RowEditor
                      row={row}
                      onCancel={() => setEditing(null)}
                      onSave={(patch, change) => {
                        actions.onEdit(row, patch, change);
                        setEditing(null);
                      }}
                    />
                  </td>
                </tr>
              ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      ) : null}
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        状态按这家公司的邮件自动推断：取走到的最远一步，收到拒信即为未通过。还在「待确认」里的邮件不参与推断。你在「编辑」里改的以你为准，「恢复」可退回系统推断。
      </p>
    </div>
  );
}


const WIDE_QUERY = "(min-width: 768px)";

/** 是不是宽屏（和 Tailwind 的 md 断点一致）。服务端渲染时按宽屏。 */
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(WIDE_QUERY);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

/** 一行（或一张卡）上的操作按钮：表格和手机卡片共用，不各写一份。 */
function RowButtons({
  row,
  editing,
  onEdit,
  actions,
}: {
  row: ApplicationRow;
  editing: boolean;
  onEdit: () => void;
  actions: ApplicationActions;
}) {
  return (
    <>
      {editing ? null : (
        <ActionButton onClick={onEdit} label={`编辑${row.company}这一行`} action="edit-row">
          编辑
        </ActionButton>
      )}
      {(row.manualStage || row.edited || row.note !== null) && row.origin !== "manual" ? (
        <ActionButton onClick={() => actions.onRestore(row)} label={`把${row.company}恢复成系统推断的`} action="restore-row">
          恢复
        </ActionButton>
      ) : null}
      {row.origin === "manual" ? (
        <ConfirmButton onConfirm={() => actions.onRemove(row)} confirmText="确认删除" label={`删除${row.company}这条投递`} action="remove-application">
          删除
        </ConfirmButton>
      ) : row.emailIds.length > 0 ? (
        <DetailButton onClick={() => actions.onDetail(row)} label={`${row.company}的详情`} />
      ) : null}
    </>
  );
}

/**
 * 编辑投递表的一行。只把你真的改了的字段存下来——没动的继续跟着邮件走。
 * 下一步和跟进日期清空 = 你特意清掉了。
 */
function RowEditor({
  row,
  onSave,
  onCancel,
}: {
  row: ApplicationRow;
  onSave: (patch: ApplicationPatch | null, change: RowEdit) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const initial = {
    company: row.company,
    role: row.role ?? "",
    location: row.location ?? "",
    next: row.next?.label ?? "",
    followUp: row.next?.dateOnly ?? "",
    note: row.note ?? "",
  };
  const [values, setValues] = useState(initial);
  const [stage, setStage] = useState<Stage>(row.stage);
  const [round, setRound] = useState<Round | "">(row.round ?? "");
  const [error, setError] = useState(false);
  const set = (field: keyof typeof initial) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [field]: event.target.value }));
  const field = "mt-1 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink";

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (values.company.trim().length === 0) {
      setError(true);
      return;
    }
    const change: RowEdit = {};
    for (const key of Object.keys(initial) as (keyof typeof initial)[]) {
      if (values[key].trim() !== initial[key].trim()) change[key] = values[key].trim();
    }
    const newRound = stage === "interview" && round !== "" ? round : null;
    const patch = stage !== row.stage || newRound !== row.round ? { stage, round: newRound } : null;
    onSave(patch, change);
  };

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-row-form>
      <label className="block text-sm text-ink-soft" htmlFor={`${id}-company`}>
        公司
        <input id={`${id}-company`} name="company" value={values.company} onChange={set("company")} className={field} />
      </label>
      <label className="block text-sm text-ink-soft" htmlFor={`${id}-role`}>
        岗位
        <input id={`${id}-role`} name="role" value={values.role} onChange={set("role")} className={field} />
      </label>
      <label className="block text-sm text-ink-soft" htmlFor={`${id}-location`}>
        工作地点
        <input id={`${id}-location`} name="location" value={values.location} onChange={set("location")} className={field} />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-sm text-ink-soft" htmlFor={`${id}-stage`}>
          当前状态
          <select id={`${id}-stage`} name="stage" value={stage} onChange={(e) => setStage(e.target.value as Stage)} className={field}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {stage === "interview" ? (
          <label className="block text-sm text-ink-soft" htmlFor={`${id}-round`}>
            第几面
            <select id={`${id}-round`} name="round" value={round} onChange={(e) => setRound(e.target.value as Round | "")} className={field}>
              <option value="">轮次未定</option>
              {ROUNDS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <label className="block text-sm text-ink-soft" htmlFor={`${id}-next`}>
        下一步
        <input id={`${id}-next`} name="next" value={values.next} onChange={set("next")} placeholder="比如：等二面通知" className={field} />
      </label>
      <label className="block text-sm text-ink-soft" htmlFor={`${id}-followup`}>
        跟进日期
        <input id={`${id}-followup`} name="followUp" type="date" value={values.followUp} onChange={set("followUp")} className={`${field} tabular`} />
      </label>
      <label className="block text-sm text-ink-soft sm:col-span-2 lg:col-span-3" htmlFor={`${id}-note`}>
        备注
        <textarea id={`${id}-note`} name="note" rows={2} maxLength={2000} value={values.note} onChange={set("note")} className={`${field} resize-y`} />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-on-drop-soft sm:col-span-2 lg:col-span-3">
          请填写公司。
        </p>
      ) : null}
      <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3">
        <ActionButton onClick={onCancel}>取消</ActionButton>
        <button type="submit" data-action="save-row" className="rounded-lg bg-brand-soft px-3 py-1 text-xs font-semibold text-on-brand-soft hover:opacity-85">
          保存
        </button>
      </div>
    </form>
  );
}

function AddApplicationForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (application: Omit<ManualApplication, "id" | "createdAtMs">) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [stage, setStage] = useState<Stage>("applied");
  const [round, setRound] = useState<Round | "">("");
  const [appliedOn, setAppliedOn] = useState("");
  const [error, setError] = useState(false);
  const field = "mt-1 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink";

  return (
    <form
      data-add-application
      className="mt-4 grid gap-3 rounded-xl border border-hairline bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_auto_auto_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (company.trim().length === 0) {
          setError(true);
          return;
        }
        onSubmit({
          company: company.trim(),
          role: role.trim(),
          stage,
          round: stage === "interview" && round !== "" ? round : null,
          appliedOn,
        });
      }}
    >
      <label className="block text-xs text-ink-soft" htmlFor={`${id}-c`}>
        公司
        <input id={`${id}-c`} name="company" value={company} onChange={(e) => setCompany(e.target.value)} className={field} autoComplete="off" aria-invalid={error} />
        {error ? <span role="alert" className="mt-1 block text-on-drop-soft">请填写公司。</span> : null}
      </label>
      <label className="block text-xs text-ink-soft" htmlFor={`${id}-r`}>
        岗位（可不填）
        <input id={`${id}-r`} name="role" value={role} onChange={(e) => setRole(e.target.value)} className={field} autoComplete="off" />
      </label>
      <label className="block text-xs text-ink-soft" htmlFor={`${id}-s`}>
        状态
        <select id={`${id}-s`} name="stage" value={stage} onChange={(e) => setStage(e.target.value as Stage)} className={field}>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        {stage === "interview" ? (
          <select aria-label="第几面" value={round} onChange={(e) => setRound(e.target.value as Round | "")} className={field}>
            <option value="">轮次未定</option>
            {ROUNDS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : null}
      </label>
      <label className="block text-xs text-ink-soft" htmlFor={`${id}-d`}>
        投递日期（可不填）
        <input id={`${id}-d`} name="appliedOn" type="date" value={appliedOn} onChange={(e) => setAppliedOn(e.target.value)} className={`${field} tabular`} />
      </label>
      <div className="flex items-end gap-2">
        <button type="submit" className="rounded-lg bg-brand-soft px-4 py-2 text-sm font-semibold text-on-brand-soft hover:opacity-85">
          添加
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-hairline px-4 py-2 text-sm text-ink-soft hover:bg-raised">
          取消
        </button>
      </div>
    </form>
  );
}
