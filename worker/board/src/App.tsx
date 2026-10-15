import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Board } from "@/components/demo/Board";
import { EMPTY_EDITS, parseEdits } from "@/lib/demo/userEdits";
import type { PrepOutput } from "@/lib/demo/prep";
import type { QuickModelOutput } from "@/lib/demo/quickAdd";
import type { UserEdits } from "@/lib/demo/userEdits";
import { extractorNote, forwardingCode, toLiveData } from "./live";
import { EmailGuide } from "./EmailGuide";
import { Login } from "./Login";
import { healthWarning, privateSettings } from "./PrivateSettings";
import type { EmailRow, NoticeRow } from "./live";

type Session = "checking" | "out" | "in";

class Unauthorized extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 401) throw new Unauthorized("请先登录");
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `请求失败（${res.status}）`);
  return body;
}

/**
 * 私人看板：登录后看收信程序存下的真实邮件。
 * 展示与交互和演示站是同一个 Board；不同的只是数据来源（D1）和手动操作存在哪（也是 D1，换设备也在）。
 */
export function App() {
  const [session, setSession] = useState<Session>("checking");

  useEffect(() => {
    api("/api/session").then(
      () => setSession("in"),
      () => setSession("out"),
    );
  }, []);

  if (session === "checking") return <Centered>载入中…</Centered>;
  if (session === "out") return <Login onDone={() => setSession("in")} />;
  return <LiveBoard onSignedOut={() => setSession("out")} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full items-center justify-center px-4 py-16 text-sm text-ink-faint">{children}</div>;
}

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; rows: EmailRow[]; notices: NoticeRow[]; edits: UserEdits };

/** 存手动操作的状态：页面右下角给一个小提示，失败了要让你知道，不能悄悄丢。 */
type SaveState = "idle" | "saving" | "saved" | "failed";

function LiveBoard({ onSignedOut }: { onSignedOut: () => void }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  /** 保存排队：上一次没存完又改了，只把最新的那份再存一次，顺序不会乱。 */
  const saving = useRef<{ busy: boolean; next: UserEdits | null }>({ busy: false, next: null });

  /** 刷新按钮的反馈：正在刷新、刷新完新增了几封、失败了。没有反馈的按钮点了等于没点。 */
  const [refreshState, setRefreshState] = useState<{ busy: boolean; text: string | null }>({ busy: false, text: null });
  const lastCount = useRef<number | null>(null);
  const lastRefreshAt = useRef(0);

  const refresh = useCallback(
    (reason: "first" | "manual" | "auto") => {
      setRefreshState((r) => ({ ...r, busy: true }));
      lastRefreshAt.current = Date.now();
      setNowMs(Date.now());
      Promise.all([
        api<{ emails: EmailRow[] }>("/api/emails"),
        api<{ notices: NoticeRow[] }>("/api/notices"),
        api<{ edits: unknown }>("/api/edits"),
      ]).then(
        ([emails, notices, edits]) => {
          const fresh = edits.edits === null ? EMPTY_EDITS : parseEdits(edits.edits);
          setLoad((current) => ({
            state: "ready",
            rows: emails.emails,
            notices: notices.notices,
            // 你刚做的操作还没存完时，以页面上的为准，别被云端那份旧的盖回去
            edits: current.state === "ready" && (saving.current.busy || saving.current.next !== null) ? current.edits : fresh,
          }));
          const before = lastCount.current;
          lastCount.current = emails.emails.length;
          const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
          const added = before === null ? 0 : emails.emails.length - before;
          setRefreshState({
            busy: false,
            text: reason === "first" ? null : added > 0 ? `${time} 已更新，新增 ${added} 封` : `${time} 已是最新`,
          });
        },
        (error: unknown) => {
          if (error instanceof Unauthorized) {
            onSignedOut();
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          // 第一次就读不到才整页报错；之后刷新失败只在按钮旁边说一声，页面上的内容留着
          setLoad((current) => (current.state === "ready" ? current : { state: "error", message }));
          setRefreshState({ busy: false, text: `刷新失败：${message}` });
        },
      );
    },
    [onSignedOut],
  );

  useEffect(() => refresh("first"), [refresh]);

  // 切回这个标签页、或者开着放了一阵：自动拉一次新数据
  useEffect(() => {
    const maybeRefresh = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefreshAt.current > 60_000) refresh("auto");
    };
    document.addEventListener("visibilitychange", maybeRefresh);
    const timer = window.setInterval(maybeRefresh, 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", maybeRefresh);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const persist = useCallback(
    async (edits: UserEdits) => {
      const queue = saving.current;
      if (queue.busy) {
        queue.next = edits;
        return;
      }
      queue.busy = true;
      setSaveState("saving");
      let current: UserEdits | null = edits;
      try {
        while (current !== null) {
          queue.next = null;
          await api("/api/edits", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(current) });
          current = queue.next;
        }
        setSaveState("saved");
      } catch (error) {
        if (error instanceof Unauthorized) onSignedOut();
        setSaveState("failed");
      } finally {
        queue.busy = false;
      }
    },
    [onSignedOut],
  );

  const onEditsChange = useCallback(
    (change: (current: UserEdits) => UserEdits) => {
      setLoad((current) => {
        if (current.state !== "ready") return current;
        const next = change(current.edits);
        void persist(next);
        return { ...current, edits: next };
      });
    },
    [persist],
  );

  const live = useMemo(() => (load.state === "ready" ? toLiveData(load.rows, viewerTimeZone) : null), [load, viewerTimeZone]);

  const signOut = async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    onSignedOut();
  };

  if (load.state === "loading" || live === null) {
    if (load.state === "error") {
      return (
        <Centered>
          <span>
            读取失败：{load.message}{" "}
            <button type="button" onClick={() => refresh("manual")} className="underline underline-offset-2">
              重试
            </button>
          </span>
        </Centered>
      );
    }
    return <Centered>正在读取你的邮件…</Centered>;
  }
  if (load.state !== "ready") return null;

  const code = forwardingCode(load.notices, nowMs);
  // 按「进库时刻」：导入的旧邮件 received_at 很早，但它们是刚进库的
  const lastStoredAt = load.rows.reduce<string | null>((latest, r) => (latest === null || r.stored_at > latest ? r.stored_at : latest), null);
  const emailCount = load.rows.length;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <Board
        samples={live.samples}
        results={live.results}
        edits={load.edits}
        onEditsChange={onEditsChange}
        nowMs={nowMs}
        viewerTimeZone={viewerTimeZone}
        blockable
        healthWarning={healthWarning(lastStoredAt, nowMs)}
        emailGuide={<EmailGuide defaultOpen={emailCount === 0} />}
        quickParse={(text) =>
          api<{ model: QuickModelOutput; warning: string | null }>("/api/quick-add", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
          })
        }
        prepare={(request) =>
          api<{ prep: PrepOutput; usedResume: boolean }>("/api/prepare", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
          })
        }
        {...(() => {
          const { groups, account } = privateSettings({ emailCount: load.rows.length, lastStoredAt, viewerTimeZone, nowMs, onSignOut: signOut });
          return { settingsGroups: groups, settingsAccount: account };
        })()}
        onPurgeEmails={async (ids) => {
          for (const id of ids) await api(`/api/emails/${encodeURIComponent(id)}`, { method: "DELETE" });
          // 云端删掉了，本地列表也拿掉
          setLoad((current) => (current.state === "ready" ? { ...current, rows: current.rows.filter((r) => !ids.includes(r.id)) } : current));
        }}
        notice={[
          emailCount === 0 ? "还没有收到邮件（招聘邮件会自动转发到 jobs@interviewtrack.me）" : `${emailCount} 封转发来的邮件`,
          "你的确认、忽略、手动添加存在云端，换设备也在。",
        ].join(" · ")}
        extractorNoteFor={(ids) => extractorNote(live.models, ids)}
        banner={
          code ? (
            <div role="status" className="mb-4 rounded-card border border-hairline bg-accent-soft px-4 py-3 text-sm text-ink">
              Gmail 转发验证码：<span className="font-mono text-base font-semibold tabular">{code.code}</span>
              <span className="ml-2 text-xs">（在 Gmail「转发」设置里填入这个码，开通自动转发）</span>
            </div>
          ) : undefined
        }
        sidebarFooter={
          <div className="flex flex-col items-start gap-2 text-xs text-ink-faint">
            <button
              type="button"
              onClick={() => refresh("manual")}
              disabled={refreshState.busy}
              data-action="refresh"
              className="inline-flex items-center gap-1 hover:text-ink-soft disabled:opacity-60"
            >
              <RefreshCw size={12} aria-hidden className={refreshState.busy ? "animate-spin" : ""} />
              {refreshState.busy ? "刷新中…" : "刷新"}
            </button>
            {refreshState.text ? (
              <span role="status" data-refresh-status>
                {refreshState.text}
              </span>
            ) : null}
            <SaveHint state={saveState} />
          </div>
        }
      />
    </div>
  );
}

function SaveHint({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const text = { saving: "保存中…", saved: "已保存到云端", failed: "保存失败：刷新后再试一次" }[state];
  return (
    <span role={state === "failed" ? "alert" : "status"} className={state === "failed" ? "text-on-drop-soft" : undefined}>
      {text}
    </span>
  );
}
