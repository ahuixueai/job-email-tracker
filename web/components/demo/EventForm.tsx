"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { zoneLabel } from "@/lib/demo/parseDemo";
import { KIND_CHOICES, resolveTime } from "@/lib/demo/userEdits";
import type { KindId, ResolvedTime, TimeKind } from "@/lib/demo/userEdits";

export interface EventFormValue {
  company: string;
  role: string;
  kind: KindId;
  time: ResolvedTime;
}

const TIME_KINDS: readonly { id: TimeKind; label: string; hint: string }[] = [
  { id: "fixed_start", label: "准点开始", hint: "到点必须在场，比如笔试开考、面试" },
  { id: "deadline", label: "截止前完成", hint: "在这之前随时做都行，比如测评" },
  { id: "none", label: "没有具体时间", hint: "信里没写，或者还没定" },
];

/**
 * 添加日程 / 确认一件待确认的事，共用这一张表单。
 *
 * 时间按**你所在的时区**填，表单上写明是哪个时区——系统不会替你猜这个钟点是哪里的。
 * 确认待确认的事时公司和岗位不可改（那是邮件里的内容），只改「是什么事」和「什么时候」。
 */
export function EventForm({
  title,
  submitLabel,
  initial,
  lockIdentity,
  viewerTimeZone,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  initial: { company: string; role: string; kind: KindId; timeKind: TimeKind; local: string };
  /** 公司和岗位只读。 */
  lockIdentity: boolean;
  viewerTimeZone: string;
  onSubmit: (value: EventFormValue) => void;
  onCancel: () => void;
}) {
  const [company, setCompany] = useState(initial.company);
  const [role, setRole] = useState(initial.role);
  const [kind, setKind] = useState<KindId>(initial.kind);
  const [timeKind, setTimeKind] = useState<TimeKind>(initial.timeKind);
  const [local, setLocal] = useState(initial.local);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const id = useId();

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (company.trim().length === 0) {
      setError("请填写公司。");
      return;
    }
    const time = resolveTime(timeKind, local, viewerTimeZone);
    if (time === null) {
      setError("请选择日期和时间；如果还没定，选「没有具体时间」。");
      return;
    }
    onSubmit({ company: company.trim(), role: role.trim(), kind, time });
  };

  const field = "mt-1 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-event-form>
      <button
        type="button"
        aria-label="取消"
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-(--jcc-overlay)"
      />
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-full w-full max-w-md overflow-y-auto rounded-t-2xl border border-hairline bg-canvas p-5 shadow-lifted sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onCancel} aria-label="关闭" className="rounded-lg p-1.5 text-ink-soft hover:bg-raised">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {lockIdentity ? (
            <div>
              <p className="text-base font-semibold break-words text-ink">{company}</p>
              <p className="text-sm break-words text-ink-soft">{role.length > 0 ? role : "岗位未写明"}</p>
            </div>
          ) : (
            <>
              <label className="block text-sm text-ink-soft" htmlFor={`${id}-company`}>
                公司
                <input
                  ref={firstField as React.RefObject<HTMLInputElement>}
                  id={`${id}-company`}
                  name="company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className={field}
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm text-ink-soft" htmlFor={`${id}-role`}>
                岗位（可不填）
                <input
                  id={`${id}-role`}
                  name="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className={field}
                  autoComplete="off"
                />
              </label>
            </>
          )}

          <label className="block text-sm text-ink-soft" htmlFor={`${id}-kind`}>
            这是什么事
            <select
              ref={lockIdentity ? (firstField as React.RefObject<HTMLSelectElement>) : undefined}
              id={`${id}-kind`}
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as KindId)}
              className={field}
            >
              {KIND_CHOICES.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend className="text-sm text-ink-soft">时间</legend>
            <div className="mt-1 space-y-1.5">
              {TIME_KINDS.map((option) => (
                <label key={option.id} className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="timeKind"
                    value={option.id}
                    checked={timeKind === option.id}
                    onChange={() => setTimeKind(option.id)}
                    className="mt-1"
                  />
                  <span>
                    {option.label}
                    <span className="block text-xs text-ink-faint">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {timeKind === "none" ? null : (
              <label className="mt-3 block text-sm text-ink-soft" htmlFor={`${id}-when`}>
                {timeKind === "deadline" ? "截止时刻" : "开始时刻"}
                <input
                  id={`${id}-when`}
                  name="when"
                  type="datetime-local"
                  value={local}
                  onChange={(e) => setLocal(e.target.value)}
                  className={`${field} tabular`}
                />
                <span className="mt-1 block text-xs text-ink-faint">
                  按{zoneLabel(viewerTimeZone)}填写（你现在所在的时区）。
                </span>
              </label>
            )}
          </fieldset>

          {error ? (
            <p role="alert" className="rounded-lg bg-drop-soft px-3 py-2 text-sm text-on-drop-soft">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-hairline px-4 py-2 text-sm text-ink-soft hover:bg-raised">
            取消
          </button>
          <button type="submit" className="rounded-lg bg-brand-soft px-4 py-2 text-sm font-semibold text-on-brand-soft hover:opacity-85">
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
