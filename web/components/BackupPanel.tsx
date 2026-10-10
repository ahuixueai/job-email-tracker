"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Download, Upload, AlertTriangle } from "lucide-react";
import { SPRING } from "@/lib/motion";
import {
  buildBackup,
  mergePayload,
  parseBackup,
  type BackupPayload,
} from "@/lib/backup";
import { useInterviewStore } from "@/store/useInterviewStore";

interface BackupPanelProps {
  reducedMotion: boolean;
  onClose: () => void;
}

interface Pending {
  payload: BackupPayload;
  skipped: string[];
  fileName: string;
}

export function BackupPanel({ reducedMotion, onClose }: BackupPanelProps) {
  const interviews = useInterviewStore((s) => s.interviews);
  const subCalendars = useInterviewStore((s) => s.subCalendars);
  const order = useInterviewStore((s) => s.order);
  const manualOrder = useInterviewStore((s) => s.manualOrder);
  const applyBackup = useInterviewStore((s) => s.applyBackup);

  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const tap = reducedMotion ? undefined : { scale: 0.96 };

  const exportJson = () => {
    const backup = buildBackup({ interviews, subCalendars, order, manualOrder });
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `job-command-center-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    // 不释放的话这份数据会一直留在内存里
    URL.revokeObjectURL(url);
    setMessage(`已导出 ${interviews.length} 场面试、${subCalendars.length} 个子日历`);
  };

  const readFile = async (file: File) => {
    setMessage(null);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setMessage("这个文件不是合法的 JSON");
      return;
    }
    const result = parseBackup(raw);
    if (!result.ok || !result.payload) {
      setMessage(result.error ?? "解析失败");
      return;
    }
    setPending({ payload: result.payload, skipped: result.skipped, fileName: file.name });
  };

  const apply = (mode: "merge" | "replace") => {
    if (!pending) return;
    const next =
      mode === "merge"
        ? mergePayload({ interviews, subCalendars, order, manualOrder }, pending.payload)
        : pending.payload;
    applyBackup(next);
    setPending(null);
    setMessage(
      mode === "merge"
        ? `已合并，现在共 ${next.interviews.length} 场`
        : `已替换为备份里的 ${next.interviews.length} 场`,
    );
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
        <h2 className="text-sm font-semibold text-ink">数据备份</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭数据备份面板"
          title="关闭"
          className="rounded-lg p-1.5 text-ink-faint hover:bg-raised"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <p className="mt-2 text-xs text-ink-faint">
        数据只存在这台设备的浏览器里。清缓存、换设备、隐私模式都会让它消失——
        定期导出一份是唯一的兜底。
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <motion.button
          type="button"
          onClick={exportJson}
          whileTap={tap}
          transition={SPRING}
          className="flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand-soft px-3 py-2 text-xs font-semibold text-ink"
        >
          <Download size={14} aria-hidden />
          导出 JSON
        </motion.button>

        <motion.button
          type="button"
          onClick={() => fileRef.current?.click()}
          whileTap={tap}
          transition={SPRING}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-xs font-medium text-ink"
        >
          <Upload size={14} aria-hidden />
          导入 JSON
        </motion.button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="选择备份文件"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file);
            // 清空 value，选同一个文件两次也能触发
            event.target.value = "";
          }}
        />
      </div>

      {message ? <p className="mt-2.5 text-xs text-ink-soft">{message}</p> : null}

      {pending ? (
        <ImportPreview
          pending={pending}
          currentCount={interviews.length}
          onCancel={() => setPending(null)}
          onApply={apply}
        />
      ) : null}
    </motion.div>
  );
}

interface ImportPreviewProps {
  pending: Pending;
  currentCount: number;
  onCancel: () => void;
  onApply: (mode: "merge" | "replace") => void;
}

/** 导入会动到现有数据，所以先把「会发生什么」摆清楚再让用户点。 */
function ImportPreview({ pending, currentCount, onCancel, onApply }: ImportPreviewProps) {
  return (
    <div className="mt-3 rounded-xl border border-hairline p-3">
      <p className="text-xs text-ink">
        <span className="font-medium">{pending.fileName}</span> 里有{" "}
        {pending.payload.interviews.length} 场面试、
        {pending.payload.subCalendars.length} 个子日历。当前有 {currentCount} 场。
      </p>

      {pending.skipped.length > 0 ? (
        <div className="mt-2 rounded-lg bg-drop-soft p-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-on-drop-soft">
            <AlertTriangle size={13} aria-hidden />
            有 {pending.skipped.length} 条没通过校验
          </p>
          <ul className="mt-1 list-inside list-disc text-xs text-on-drop-soft">
            {pending.skipped.slice(0, 5).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
            {pending.skipped.length > 5 ? (
              <li>还有 {pending.skipped.length - 5} 条…</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs text-ink-soft hover:bg-raised"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => onApply("replace")}
          className="rounded-lg bg-drop-soft px-3 py-1.5 text-xs font-medium text-on-drop-soft"
        >
          替换现有 {currentCount} 场
        </button>
        <button
          type="button"
          onClick={() => onApply("merge")}
          className="rounded-lg border border-brand-line bg-brand-soft px-3 py-1.5 text-xs font-semibold text-ink"
        >
          合并（推荐）
        </button>
      </div>
    </div>
  );
}
