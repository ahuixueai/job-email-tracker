"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { X, Trash2, Check } from "lucide-react";
import type { Interview } from "@/types";
import { SPRING } from "@/lib/motion";
import {
  TYPE_OPTIONS,
  emptyForm,
  formFromInterview,
  interviewFromForm,
  timeZoneOptions,
  validateForm,
  type FormErrors,
  type InterviewFormValues,
} from "@/lib/interviewForm";
import { useInterviewStore } from "@/store/useInterviewStore";
import { Field, Row, inputClass } from "@/components/FormBits";

interface InterviewFormProps {
  /** 传入表示编辑，null 表示新建。 */
  editing: Interview | null;
  reducedMotion: boolean;
  onClose: () => void;
}

export function InterviewForm({ editing, reducedMotion, onClose }: InterviewFormProps) {
  const subCalendars = useInterviewStore((s) => s.subCalendars);
  const addInterview = useInterviewStore((s) => s.addInterview);
  const updateInterview = useInterviewStore((s) => s.updateInterview);
  const removeInterview = useInterviewStore((s) => s.removeInterview);

  const [values, setValues] = useState<InterviewFormValues>(() =>
    editing
      ? formFromInterview(editing)
      : emptyForm(subCalendars[0]?.id ?? ""),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const zones = useMemo(() => timeZoneOptions(), []);

  const set = <K extends keyof InterviewFormValues>(
    key: K,
    value: InterviewFormValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

  const submit = () => {
    const found = validateForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const draft = interviewFromForm(values);
    if (editing) {
      // 编辑时保留状态和来源，别把「已拿 Offer」改回「已排期」
      updateInterview(editing.id, {
        ...draft,
        status: editing.status,
        externalId: editing.externalId ?? null,
        source: editing.source ?? "manual",
        prep: { ...draft.prep, checklist: editing.prep.checklist },
      }, Date.now());
    } else {
      addInterview(draft, Date.now());
    }
    onClose();
  };

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={reducedMotion ? { duration: 0 } : SPRING}
      className="mt-3 rounded-card border border-hairline bg-surface p-3 shadow-card"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">
          {editing ? "编辑面试" : "新建面试"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭表单"
          title="关闭"
          className="rounded-lg p-1.5 text-ink-faint hover:bg-raised"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        <Row>
          <Field label="公司" error={errors.company}>
            <input
              className={inputClass}
              value={values.company}
              onChange={(e) => set("company", e.target.value)}
              placeholder="字节跳动"
            />
          </Field>
          <Field label="岗位" error={errors.position}>
            <input
              className={inputClass}
              value={values.position}
              onChange={(e) => set("position", e.target.value)}
              placeholder="数据分析 · 三面"
            />
          </Field>
        </Row>

        <Field
          label="面试当地时区"
          hint="时间按这个时区填，卡片会自动换算成你所在地的时间"
        >
          <select
            className={inputClass}
            value={values.sourceTimeZone}
            onChange={(e) => set("sourceTimeZone", e.target.value)}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={values.timePrecision === "date"}
            onChange={(e) =>
              set("timePrecision", e.target.checked ? "date" : "timed")
            }
          />
          只知道日期，还没有具体时间
        </label>

        <Row>
          <Field label="日期（当地）" error={errors.date}>
            <input
              type="date"
              className={inputClass}
              value={values.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          {values.timePrecision === "timed" ? (
            <>
              <Field label="时间（当地）" error={errors.time}>
                <input
                  type="time"
                  className={inputClass}
                  value={values.time}
                  onChange={(e) => set("time", e.target.value)}
                />
              </Field>
              <Field label="时长（分钟）" error={errors.durationMinutes}>
                <input
                  type="number"
                  min={1}
                  max={600}
                  className={inputClass}
                  value={values.durationMinutes}
                  onChange={(e) => set("durationMinutes", e.target.value)}
                />
              </Field>
            </>
          ) : null}
        </Row>

        <Row>
          <Field label="类型">
            <select
              className={inputClass}
              value={values.type}
              onChange={(e) =>
                set("type", e.target.value as InterviewFormValues["type"])
              }
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="重要度 1-5">
            <select
              className={inputClass}
              value={values.importance}
              onChange={(e) =>
                set("importance", Number(e.target.value) as InterviewFormValues["importance"])
              }
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="分组">
            <select
              className={inputClass}
              value={values.subCalendarId}
              onChange={(e) => set("subCalendarId", e.target.value)}
            >
              {subCalendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.name}
                </option>
              ))}
            </select>
          </Field>
        </Row>

        <Field label="会议链接" error={errors.meetingUrl}>
          <input
            className={inputClass}
            value={values.meetingUrl}
            onChange={(e) => set("meetingUrl", e.target.value)}
            placeholder="https://meeting.tencent.com/..."
          />
        </Field>
        <Field label="JD 笔记">
          <textarea
            rows={2}
            className={inputClass}
            value={values.jdNotes}
            onChange={(e) => set("jdNotes", e.target.value)}
            placeholder="重点考什么、面试官是谁"
          />
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {editing ? (
          <button
            type="button"
            onClick={() => {
              removeInterview(editing.id);
              onClose();
            }}
            className="flex items-center gap-1.5 rounded-lg bg-drop-soft px-2.5 py-2 text-xs font-medium text-on-drop-soft"
          >
            <Trash2 size={14} aria-hidden />
            删除这场
          </button>
        ) : null}
        <motion.button
          type="button"
          onClick={submit}
          whileTap={reducedMotion ? undefined : { scale: 0.96 }}
          transition={SPRING}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand-soft px-4 py-2 text-xs font-semibold text-ink"
        >
          <Check size={14} aria-hidden />
          {editing ? "保存" : "添加到列表"}
        </motion.button>
      </div>
    </motion.div>
  );
}
