"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { zoneLabel } from "@/lib/demo/parseDemo";
import { EMPTY_QUICK_MODEL, QUICK_MAX_CHARS, resolveQuick } from "@/lib/demo/quickAdd";
import type { QuickModelOutput } from "@/lib/demo/quickAdd";
import { ITEM_NOTE_MAX, KIND_CHOICES, resolveTime } from "@/lib/demo/userEdits";
import type { KindId, ResolvedTime, TimeKind } from "@/lib/demo/userEdits";

export interface EventFormValue {
  company: string;
  role: string;
  kind: KindId;
  time: ResolvedTime;
  /** 记住：以后这家公司的邮件都按这个时区。 */
  rememberZone: boolean;
  /** 备注（只有编辑时有）。 */
  note: string;
  /** 记住改名：以后这家公司都按新名字显示。 */
  rememberName: boolean;
}

/** 下拉里的常用时区。看的人所在时区和这件事原本的时区会自动加进来。 */
const COMMON_ZONES = [
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
] as const;

const TIME_KINDS: readonly { id: TimeKind; label: string; hint: string }[] = [
  { id: "fixed_start", label: "准点开始", hint: "到点必须在场，比如笔试开考、面试" },
  { id: "deadline", label: "截止前完成", hint: "在这之前随时做都行，比如测评" },
  { id: "none", label: "没有具体时间", hint: "信里没写，或者还没定" },
];

/**
 * 添加日程 / 确认一件待确认的事 / 编辑一件事，共用这一张表单。
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
  rememberFor = null,
  showNote = false,
  renameFrom = null,
  quickParse,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  initial: { company: string; role: string; kind: KindId; timeKind: TimeKind; local: string; timeZone: string; note?: string };
  /** 公司和岗位只读。 */
  lockIdentity: boolean;
  viewerTimeZone: string;
  /** 给出公司名时显示「以后这家公司的邮件都按这个时区」的勾选框。 */
  rememberFor?: string | null;
  /** 显示备注框（编辑时）。 */
  showNote?: boolean;
  /** 系统认出的公司名。你把公司改成别的名字时，问要不要以后都这样显示。 */
  renameFrom?: string | null;
  /** 一句话添加：把原话交给 AI 认公司和岗位（只有私人看板、只在「添加」时有）。时间由规则从原话里算。 */
  quickParse?: (text: string) => Promise<{ model: QuickModelOutput; warning: string | null }>;
  onSubmit: (value: EventFormValue) => void;
  onCancel: () => void;
}) {
  const [company, setCompany] = useState(initial.company);
  const [role, setRole] = useState(initial.role);
  const [kind, setKind] = useState<KindId>(initial.kind);
  const [timeKind, setTimeKind] = useState<TimeKind>(initial.timeKind);
  const [local, setLocal] = useState(initial.local);
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const [rememberZone, setRememberZone] = useState(false);
  const [note, setNote] = useState(initial.note ?? "");
  const [rememberName, setRememberName] = useState(false);
  const renamed = renameFrom !== null && renameFrom.trim().length > 0 && company.trim().length > 0 && company.trim() !== renameFrom.trim();
  const zones = [...new Set<string>([viewerTimeZone, initial.timeZone, ...COMMON_ZONES])];
  const [error, setError] = useState<string | null>(null);
  const [quickText, setQuickText] = useState("");
  const [quick, setQuick] = useState<{ busy: boolean; summary: string | null; notes: string[]; error: string | null } | null>(null);
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

  const recognize = async () => {
    if (!quickParse || quickText.trim().length === 0) return;
    setQuick({ busy: true, summary: null, notes: [], error: null });
    // AI 那一半失败了（没配置、断网），规则照样从原话里算时间——只是公司、岗位得你自己填
    let model = EMPTY_QUICK_MODEL;
    let warning: string | null = null;
    let failure: string | null = null;
    try {
      ({ model, warning } = await quickParse(quickText));
    } catch (e) {
      failure = e instanceof Error ? e.message : "AI 识别失败";
    }
    const r = resolveQuick(quickText, model, Date.now(), viewerTimeZone);
    setCompany(r.company);
    setRole(r.role);
    setKind(r.kind);
    setTimeKind(r.timeKind);
    setLocal(r.local);
    setTimeZone(r.timeZone);
    setError(null);
    setQuick({ busy: false, summary: r.summary, notes: warning ? [warning, ...r.notes] : r.notes, error: failure });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (company.trim().length === 0) {
      setError("请填写公司。");
      return;
    }
    const time = resolveTime(timeKind, local, timeZone);
    if (time === null) {
      setError("请选择日期和时间；如果还没定，选「没有具体时间」。");
      return;
    }
    onSubmit({
      company: company.trim(),
      role: role.trim(),
      kind,
      time,
      rememberZone: rememberZone && timeKind !== "none",
      note: note.trim(),
      rememberName: rememberName && renamed,
    });
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
          {quickParse ? (
            <div className="rounded-xl border border-hairline bg-surface p-3" data-quick-add>
              <label className="block text-sm text-ink-soft" htmlFor={`${id}-quick`}>
                一句话添加
                <span className="ml-1 text-xs text-ink-faint">识别后填好下面的表，你核对后再点「{submitLabel}」</span>
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  ref={firstField as React.RefObject<HTMLInputElement>}
                  id={`${id}-quick`}
                  name="quick"
                  value={quickText}
                  maxLength={QUICK_MAX_CHARS}
                  onChange={(e) => setQuickText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void recognize();
                    }
                  }}
                  placeholder="例：周四下午3点星河科技二面，飞书，北京时间"
                  className={`${field} mt-0 min-w-0 flex-1`}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => void recognize()}
                  disabled={quick?.busy === true || quickText.trim().length === 0}
                  data-action="quick-recognize"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-soft px-3 text-sm font-semibold text-on-brand-soft hover:opacity-85 disabled:opacity-50"
                >
                  <Sparkles size={14} aria-hidden />
                  {quick?.busy ? "识别中…" : "识别"}
                </button>
              </div>
              {quick && !quick.busy ? (
                <div className="mt-2 space-y-1 text-xs leading-relaxed" data-quick-result>
                  {quick.error ? <p className="text-on-drop-soft">{quick.error}</p> : null}
                  {quick.summary ? (
                    <p className="text-ink">
                      我理解为：<span className="font-semibold tabular" data-quick-summary>{quick.summary}</span>
                    </p>
                  ) : null}
                  {quick.notes.map((note) => (
                    <p key={note} className="text-ink-soft" data-quick-note>
                      · {note}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
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
                  ref={quickParse ? undefined : (firstField as React.RefObject<HTMLInputElement>)}
                  id={`${id}-company`}
                  name="company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className={field}
                  autoComplete="off"
                />
              </label>
              {renamed ? (
                <label className="-mt-2 flex cursor-pointer items-start gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="rememberName"
                    checked={rememberName}
                    onChange={(e) => setRememberName(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    以后「{renameFrom}」都显示为「{company.trim()}」
                    <span className="block text-xs text-ink-faint">系统认错公司名时用：以后这家公司的信都按你改的名字显示。</span>
                  </span>
                </label>
              ) : null}
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
              </label>
            )}
            {timeKind === "none" ? null : (
              <label className="mt-3 block text-sm text-ink-soft" htmlFor={`${id}-zone`}>
                这是哪里的时间
                <select
                  id={`${id}-zone`}
                  name="zone"
                  value={timeZone}
                  onChange={(e) => setTimeZone(e.target.value)}
                  className={field}
                >
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zoneLabel(zone)}
                      {zone === viewerTimeZone ? "（你现在所在）" : ""}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-ink-faint">
                  照着邮件里写的时间填，再选它是哪里的时间。看板会换算成你这里的时间显示。
                </span>
              </label>
            )}
            {timeKind !== "none" && rememberFor ? (
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="rememberZone"
                  checked={rememberZone}
                  onChange={(e) => setRememberZone(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  以后「{rememberFor}」的邮件都按{zoneLabel(timeZone)}处理
                  <span className="block text-xs text-ink-faint">信里没写时区时才用它；信里写明了的仍以信里为准。</span>
                </span>
              </label>
            ) : null}
          </fieldset>

          {showNote ? (
            <label className="block text-sm text-ink-soft" htmlFor={`${id}-note`}>
              备注（可不填）
              <textarea
                id={`${id}-note`}
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={note.length > 300 ? 12 : 3}
                maxLength={ITEM_NOTE_MAX}
                placeholder="面试官、要准备的点、注意事项……"
                className={`${field} resize-y`}
              />
            </label>
          ) : null}

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
