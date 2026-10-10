"use client";

import { useId, useState } from "react";
import { AddButton } from "@/components/demo/AgendaView";
import { ActionButton, DetailButton } from "@/components/demo/EventCard";
import { nextText, STAGE_LABEL, stageText } from "@/lib/demo/applications";
import type { ApplicationRow } from "@/lib/demo/applications";
import { dateKeyIn } from "@/lib/demo/agenda";
import { ROUNDS, STAGES } from "@/lib/demo/userEdits";
import type { ApplicationPatch, ManualApplication, Round, Stage } from "@/lib/demo/userEdits";

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
  onPatch: (row: ApplicationRow, patch: ApplicationPatch) => void;
  onUnpatch: (row: ApplicationRow) => void;
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
}: {
  rows: readonly ApplicationRow[];
  viewerTimeZone: string;
  actions: ApplicationActions;
}) {
  const [filter, setFilter] = useState<Stage | "all">("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const shown = filter === "all" ? rows : rows.filter((row) => row.stage === filter);

  const chips: readonly { id: Stage | "all"; label: string; count: number }[] = [
    { id: "all", label: "全部", count: rows.length },
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

      <div className="mt-4 overflow-x-auto rounded-xl border border-hairline bg-surface">
        <table className="w-full min-w-[52rem] border-collapse text-left text-sm" data-applications-table>
          <thead>
            <tr className="border-b border-hairline text-xs text-ink-faint">
              <th scope="col" className="px-4 py-2.5 font-medium">公司</th>
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
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-ink-faint">
                  这个状态下没有投递记录。
                </td>
              </tr>
            ) : null}
            {shown.map((row) => (
              <tr key={row.key} className="border-b border-hairline align-top last:border-b-0" data-application-row={row.key}>
                <th scope="row" className="px-4 py-3 font-semibold break-words text-ink">
                  {row.company}
                  {row.origin === "manual" ? (
                    <span className="mt-0.5 block text-xs font-normal text-ink-faint">手动添加</span>
                  ) : null}
                </th>
                <td className="px-3 py-3 break-words text-ink-soft">{row.role ?? "未写明"}</td>
                <td className="px-3 py-3">
                  {editing === row.key ? (
                    <StageEditor
                      row={row}
                      onCancel={() => setEditing(null)}
                      onSave={(patch) => {
                        actions.onPatch(row, patch);
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StageChip row={row} />
                      {row.manualStage && row.origin === "email" ? (
                        <span className="text-xs text-ink-faint">手动</span>
                      ) : null}
                      {row.resultUnclear ? (
                        <span className="text-xs text-ink-faint">有结果通知，见详情</span>
                      ) : null}
                    </div>
                  )}
                </td>
                <td className="tabular px-3 py-3 text-ink-soft">{nextText(row, viewerTimeZone)}</td>
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
                    {editing === row.key ? null : (
                      <ActionButton onClick={() => setEditing(row.key)} label={`修改${row.company}的状态`} action="edit-stage">
                        改状态
                      </ActionButton>
                    )}
                    {row.manualStage && row.origin === "email" ? (
                      <ActionButton onClick={() => actions.onUnpatch(row)} label={`把${row.company}的状态恢复成系统推断的`} action="unpatch">
                        恢复
                      </ActionButton>
                    ) : null}
                    {row.origin === "manual" ? (
                      <ActionButton onClick={() => actions.onRemove(row)} label={`删除${row.company}这条投递`} action="remove-application">
                        删除
                      </ActionButton>
                    ) : (
                      <DetailButton onClick={() => actions.onDetail(row)} label={`${row.company}的详情`} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        状态按这家公司的邮件自动推断：取走到的最远一步，收到拒信即为未通过。还在「待确认」里的邮件不参与推断。
      </p>
    </div>
  );
}

const selectStyle = "rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink";

function StageEditor({
  row,
  onSave,
  onCancel,
}: {
  row: ApplicationRow;
  onSave: (patch: ApplicationPatch) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>(row.stage);
  const [round, setRound] = useState<Round | "">(row.round ?? "");
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-stage-editor>
      <select aria-label="状态" value={stage} onChange={(e) => setStage(e.target.value as Stage)} className={selectStyle}>
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </select>
      {stage === "interview" ? (
        <select aria-label="第几面" value={round} onChange={(e) => setRound(e.target.value as Round | "")} className={selectStyle}>
          <option value="">轮次未定</option>
          {ROUNDS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : null}
      <ActionButton onClick={() => onSave({ stage, round: stage === "interview" && round !== "" ? round : null })} tone="primary" action="save-stage">
        保存
      </ActionButton>
      <ActionButton onClick={onCancel}>取消</ActionButton>
    </div>
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
