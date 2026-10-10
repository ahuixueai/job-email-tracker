"use client";

/** 表单里反复用到的三件小东西，抽出来免得每个字段抄一遍类名。 */

export const inputClass =
  "w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint";

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2.5">{children}</div>;
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label className="min-w-[7rem] flex-1 text-xs text-ink-soft">
      <span>{label}</span>
      <span className="mt-1 block">{children}</span>
      {error ? (
        <span className="mt-1 block text-on-drop-soft">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}
