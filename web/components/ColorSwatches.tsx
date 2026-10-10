"use client";

/** 子日历可选的标签色。刻意避开与状态语义（绿/红）冲突的色相。 */
export const CALENDAR_SWATCHES = [
  "#7DB8E8",
  "#FFC93C",
  "#9C8FE0",
  "#5EC2B7",
  "#E89A7D",
  "#8FB16A",
] as const;

interface ColorSwatchesProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorSwatches({ value, onChange }: ColorSwatchesProps) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="标签色">
      {CALENDAR_SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={`标签色 ${color}`}
          onClick={() => onChange(color)}
          className={`h-6 w-6 rounded-full border-2 ${
            value === color ? "border-ink" : "border-transparent"
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
