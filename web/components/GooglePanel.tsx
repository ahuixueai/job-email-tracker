"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, RefreshCw, Link2, Unlink, Download } from "lucide-react";
import { SPRING } from "@/lib/motion";
import { getLocalTimeZone } from "@/lib/time";
import type { EventCandidate } from "@/lib/integrations/parseCalendar";
import { useInterviewStore } from "@/store/useInterviewStore";
import { CandidateList } from "@/components/CandidateList";

interface Status {
  configured: boolean;
  connected: boolean;
  account?: string | null;
  missing?: string[];
}

interface GooglePanelProps {
  reducedMotion: boolean;
  onClose: () => void;
}

export function GooglePanel({ reducedMotion, onClose }: GooglePanelProps) {
  const subCalendars = useInterviewStore((s) => s.subCalendars);
  const importInterviews = useInterviewStore((s) => s.importInterviews);

  const [status, setStatus] = useState<Status | null>(null);
  const [candidates, setCandidates] = useState<EventCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/google/status");
      setStatus((await res.json()) as Status);
    } catch {
      // 取不到状态就按「没配置」渲染，不要把面板卡在加载中
      setStatus({ configured: false, connected: false, missing: ["无法访问本地接口"] });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/integrations/google/status")
      .then((res) => res.json())
      .then((data: Status) => {
        if (alive) setStatus(data);
      })
      .catch(() => {
        if (alive) {
          setStatus({ configured: false, connected: false, missing: ["无法访问本地接口"] });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const scan = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const tz = encodeURIComponent(getLocalTimeZone());
      const res = await fetch(`/api/integrations/google/import?days=45&tz=${tz}`);
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        scanned?: number;
        candidates?: EventCandidate[];
      };
      if (!data.ok) {
        setMessage(data.error ?? "拉取失败");
        void refreshStatus();
        return;
      }
      setCandidates(data.candidates ?? []);
      setMessage(
        `扫了 ${data.scanned ?? 0} 个日程，挑出 ${data.candidates?.length ?? 0} 个像面试的`,
      );
    } finally {
      setBusy(false);
    }
  }, [refreshStatus]);

  const confirmImport = useCallback(
    (chosen: EventCandidate[]) => {
      const calendarId = subCalendars[0]?.id ?? "";
      const added = importInterviews(
        chosen.map((c) => ({
          company: c.company,
          position: c.position,
          startUtc: c.startUtc,
          endUtc: c.endUtc,
          sourceTimeZone: c.sourceTimeZone,
          timePrecision: c.timePrecision,
          sourceTimeZoneConfirmed: c.sourceTimeZoneConfirmed,
          importance: c.importance,
          type: c.type,
          status: "scheduled" as const,
          subCalendarId: calendarId,
          location: c.location,
          externalId: c.externalId,
          source: "google-calendar" as const,
          prep: {
            meetingUrl: c.meetingUrl,
            resumeUrl: null,
            jdNotes: c.notes,
            checklist: [],
          },
        })),
        Date.now(),
      );
      setCandidates(null);
      setMessage(
        added === chosen.length
          ? `导入了 ${added} 场`
          : `导入了 ${added} 场，${chosen.length - added} 场之前已经导过`,
      );
    },
    [importInterviews, subCalendars],
  );

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={reducedMotion ? { duration: 0 } : SPRING}
      className="mt-3 rounded-card border border-hairline bg-surface p-3 shadow-card"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Google 日历</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭 Google 面板"
          title="关闭"
          className="rounded-lg p-1.5 text-ink-faint hover:bg-raised"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      {status === null ? (
        <p className="mt-3 text-xs text-ink-faint">正在检查连接状态…</p>
      ) : !status.configured ? (
        <UnconfiguredNotice missing={status.missing ?? []} />
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {status.connected ? (
              <>
                <span className="text-xs text-ink-soft">
                  已连接 <span className="text-ink">{status.account}</span>
                </span>
                <button
                  type="button"
                  onClick={scan}
                  disabled={busy}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand-soft px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                >
                  {busy ? (
                    <RefreshCw size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <Download size={13} aria-hidden />
                  )}
                  扫描未来 45 天
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await fetch("/api/integrations/google/disconnect", { method: "POST" });
                    setCandidates(null);
                    setMessage("已断开，并已在 Google 侧吊销授权");
                    void refreshStatus();
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-soft hover:bg-raised"
                >
                  <Unlink size={13} aria-hidden />
                  断开
                </button>
              </>
            ) : (
              <a
                href="/api/integrations/google/start"
                className="flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand-soft px-3 py-2 text-xs font-semibold text-ink"
              >
                <Link2 size={14} aria-hidden />
                连接 Google 账号（只读）
              </a>
            )}
          </div>

          {message ? <p className="text-xs text-ink-soft">{message}</p> : null}

          {candidates ? (
            <CandidateList
              candidates={candidates}
              onCancel={() => setCandidates(null)}
              onConfirm={confirmImport}
            />
          ) : null}
        </div>
      )}
    </motion.div>
  );
}

function UnconfiguredNotice({ missing }: { missing: string[] }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-hairline p-3">
      <p className="text-xs text-ink">
        还没配置 Google OAuth，所以这里连不上。缺这些环境变量：
      </p>
      <ul className="mt-1.5 list-inside list-disc text-xs text-ink-soft">
        {missing.map((key) => (
          <li key={key}>{key}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-faint">
        照着项目根目录的 .env.local.example 填进 .env.local，重启 dev server 即可。
        凭据只留在你本机，不会进仓库。
      </p>
    </div>
  );
}
