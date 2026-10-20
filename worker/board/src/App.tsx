import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Board } from "@/components/demo/Board";
import { DEFAULT_PREFS, effectiveHomeZone, parsePrefs } from "@/lib/demo/boardPrefs";
import type { BoardPrefs, TimeZonePrefs } from "@/lib/demo/boardPrefs";
import { EMPTY_EDITS, parseEdits } from "@/lib/demo/userEdits";
import type { PrepOutput } from "@/lib/demo/prep";
import type { QuickModelOutput } from "@/lib/demo/quickAdd";
import type { UserEdits } from "@/lib/demo/userEdits";
import { extractorNote, forwardingNotices, noticeGroupIds, toLiveData } from "./live";
import { ForwardingNotices } from "./ForwardingNotices";
import { ForwardSetup, SetupWizard } from "./ForwardSetup";
import type { Provider } from "./ForwardSetup";
import { EmailGuide } from "./EmailGuide";
import { Login } from "./Login";
import { healthWarning, privateSettings } from "./PrivateSettings";
import { parseSession, SessionContext } from "./session";
import type { SessionData } from "./session";
import { TimeZoneOnboarding } from "./TimeZoneSettings";
import type { EmailRow, NoticeRow } from "./live";

type Session = { state: "checking" } | { state: "out" } | { state: "in"; data: SessionData };

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
  const [session, setSession] = useState<Session>({ state: "checking" });

  /** 读一次登录信息。没登录、或读到的不对，都回到登录页。 */
  const load = useCallback(
    () =>
      api("/api/session").then(
        (body) => {
          const data = parseSession(body);
          setSession(data ? { state: "in", data } : { state: "out" });
        },
        () => setSession({ state: "out" }),
      ),
    [],
  );
  useEffect(() => void load(), [load]);
  const signedOut = useCallback(() => setSession({ state: "out" }), []);
  const context = useMemo(() => (session.state === "in" ? { session: session.data, reload: load } : null), [session, load]);

  if (session.state === "checking") return <Centered>载入中…</Centered>;
  if (session.state === "out" || context === null) return <Login onDone={() => void load()} />;
  return (
    <SessionContext.Provider value={context}>
      <LiveBoard inbox={context.session.inbox} onSignedOut={signedOut} />
    </SessionContext.Provider>
  );
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

function LiveBoard({ inbox, onSignedOut }: { inbox: string; onSignedOut: () => void }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [deviceZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  /** 偏好里的两个时区。null = 还在读。 */
  const [prefs, setPrefs] = useState<BoardPrefs | null>(null);
  /** 偏好读失败：不弹首次设置（免得把已经设过的人又问一遍），先按跟随设备显示。 */
  const [prefsFailed, setPrefsFailed] = useState(false);
  const viewerTimeZone = prefs === null ? deviceZone : effectiveHomeZone(prefs.timeZones, deviceZone);
  /** 改了求职地之后按新设置重算已收到的邮件：进度 / 结果的一句话。 */
  const [reparse, setReparse] = useState<{ busy: boolean; text: string; mode: "zone" | "model" } | null>(null);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  /** 自动转发设置向导：还没收到过信时，登录后弹一次（叉掉就关，这次登录不再自己弹）；page 是翻到第几页。 */
  const [wizard, setWizard] = useState<{ open: boolean; page: number; shown: boolean; provider: Provider | null }>({ open: false, page: 0, shown: false, provider: null });
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

  // 还没收到过信、选好了时区：弹出设置向导（每次登录弹一次）
  const noMailYet = load.state === "ready" && load.rows.length === 0;
  const zonesReady = prefs !== null && (prefs.timeZones.job !== null || prefsFailed);
  useEffect(() => {
    if (noMailYet && zonesReady && !wizard.shown) setWizard((w) => ({ ...w, open: true, page: 0, shown: true }));
  }, [noMailYet, zonesReady, wizard.shown]);
  const closeWizard = useCallback(() => setWizard((w) => ({ ...w, open: false })), []);

  useEffect(() => {
    api<{ prefs: unknown }>("/api/prefs").then(
      (body) => {
        const loaded = parsePrefs(body.prefs);
        setPrefs(loaded);
        // 记下这台设备的时区：「你在哪」选了跟随设备时，邮件提醒靠它算「前一天晚上 8 点」
        if (loaded.deviceZone !== deviceZone) {
          api("/api/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceZone }) }).catch(() => undefined);
        }
      },
      (error: unknown) => {
        if (error instanceof Unauthorized) onSignedOut();
        // 读不到就先按默认（跟随设备、没设求职地），不挡住看板
        else {
          setPrefs(DEFAULT_PREFS);
          setPrefsFailed(true);
        }
      },
    );
  }, [onSignedOut, deviceZone]);

  /**
   * 一批一批重判已存的邮件，做完刷新一次。
   * zone：改了求职地，按现在的规则和设置重判（不调模型，不花钱）。
   * model：收信时模型没响应、只用了规则的那几封，重新调用模型摘一遍（花这几封的钱）。
   */
  const runReparse = useCallback(
    async (mode: "zone" | "model") => {
      const doing = mode === "zone" ? "正在按新的求职地重算已收到的邮件…" : "正在用 AI 重新解析当时没响应的邮件…";
      let after: string | null = null;
      let checked = 0;
      let changed = 0;
      let failed = 0;
      setReparse({ mode, busy: true, text: doing });
      try {
        do {
          const r: { next: string | null; checked: number; changed: number; failed?: number } = await api("/api/reparse", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(mode === "model" ? { after, retryModel: true } : { after }),
          });
          checked += r.checked;
          changed += r.changed;
          failed += r.failed ?? 0;
          after = r.next;
          setReparse({ mode, busy: true, text: `${doing}（已处理 ${checked} 封）` });
        } while (after !== null);
        // 还没有信（新用户刚选完求职地）：没什么可重算的，不打扰
        if (checked === 0) {
          setReparse(null);
          return;
        }
        setReparse({
          mode,
          busy: false,
          text:
            mode === "zone"
              ? `已按新的求职地重算 ${checked} 封邮件，${changed} 封的结论有变化。`
              : `已用 AI 重新解析 ${checked} 封，${changed} 封的结论有变化。${failed > 0 ? `其中 ${failed} 封 AI 这次还是没响应，稍后可以再试。` : ""}`,
        });
        refresh("manual");
      } catch (error) {
        if (error instanceof Unauthorized) onSignedOut();
        setReparse({
          mode,
          busy: false,
          text:
            mode === "zone"
              ? `重算没做完（已处理 ${checked} 封），刷新页面后在「设置 → 时区」里再选一次求职地即可接着做。`
              : `没做完（已处理 ${checked} 封），刷新页面后在「设置 → 收信」里再点一次即可接着做。`,
        });
      }
    },
    [refresh, onSignedOut],
  );

  const saveZones = useCallback(
    async (zones: TimeZonePrefs) => {
      const before = prefs?.timeZones.job ?? null;
      const body = await api<{ prefs: unknown }>("/api/prefs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeZones: zones }),
      });
      const saved = parsePrefs(body.prefs);
      setPrefs(saved);
      if (saved.timeZones.job !== before) void runReparse("zone");
    },
    [prefs, runReparse],
  );

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

  /** 转发确认做完了：页面上马上收起，云端也删掉，换设备也不再出现。 */
  const confirmDone = useCallback(
    (id: string) => {
      const ids = load.state === "ready" ? noticeGroupIds(load.notices, id) : [id];
      setLoad((current) => (current.state === "ready" ? { ...current, notices: current.notices.filter((n) => !ids.includes(n.id)) } : current));
      for (const one of ids) {
        api(`/api/notices/${encodeURIComponent(one)}`, { method: "DELETE" }).catch((error: unknown) => {
          if (error instanceof Unauthorized) onSignedOut();
        });
      }
    },
    [load, onSignedOut],
  );

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
  if (prefs === null) return <Centered>正在读取你的设置…</Centered>;
  if (prefs.timeZones.job === null && !prefsFailed) return <TimeZoneOnboarding deviceZone={deviceZone} onSave={saveZones} />;

  // 按「进库时刻」：导入的旧邮件 received_at 很早，但它们是刚进库的
  const lastStoredAt = load.rows.reduce<string | null>((latest, r) => (latest === null || r.stored_at > latest ? r.stored_at : latest), null);
  // 转发确认：点了确认（或「我已确认好了」）就删掉；之后有没有信进来不算数，手动转发的信也会进来
  const confirmations = forwardingNotices(load.notices, nowMs);
  const gmailConfirm = confirmations.find((n) => n.provider === "gmail" && n.code !== null);
  const code = gmailConfirm?.code ? { code: gmailConfirm.code } : null;
  // 其他邮箱（QQ 等）一天内发来的转发确认：顶上提醒一句，按钮在「邮件」页
  const otherConfirm = confirmations.find((n) => n.provider === "other" && nowMs - Date.parse(n.receivedAt) < 86_400_000);
  const emailCount = load.rows.length;
  /** 还没收到过任何转来的信：登录时弹设置向导，页面顶上留一行提醒。 */
  const firstRun = emailCount === 0;
  // 收信时模型没响应、只用了规则解析的信（公司名可能没认出）
  const modelFailed = load.rows.filter((r) => r.status === "parsed" && (r.error ?? "").startsWith("模型调用失败")).length;

  return (
    <div>
      <Board
        samples={live.samples}
        results={live.results}
        edits={load.edits}
        onEditsChange={onEditsChange}
        nowMs={nowMs}
        viewerTimeZone={viewerTimeZone}
        blockable
        healthWarning={healthWarning(lastStoredAt, nowMs)}
        emailGuide={
          // 「邮件」页：转发确认、自动转发设置（还没收到信时默认展开）、手动转发 · 批量导入
          <>
            <ForwardingNotices notices={confirmations} viewerTimeZone={viewerTimeZone} onDone={confirmDone} />
            <details className="group mb-5" data-setup-details open={firstRun}>
              <summary className="cursor-pointer list-none rounded-card border border-hairline bg-surface px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
                自动转发设置
                <span className="ml-2 font-normal text-ink-faint">{firstRun ? "还没设好：招聘邮件还进不来" : "换邮箱、或者转发断了时看这里"}</span>
              </summary>
              <div className="mt-3">
                <ForwardSetup emailCount={emailCount} confirmations={confirmations} viewerTimeZone={viewerTimeZone} onConfirmDone={confirmDone} />
              </div>
            </details>
            <EmailGuide defaultOpen={false} />
          </>
        }
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
          const { groups, account } = privateSettings({
            emailCount: load.rows.length,
            lastStoredAt,
            viewerTimeZone,
            nowMs,
            onSignOut: signOut,
            zones: prefs.timeZones,
            deviceZone,
            onSaveZones: saveZones,
            reparse: reparse?.mode === "zone" ? reparse.text : null,
            modelFailed,
            reparseBusy: reparse?.busy ?? false,
            onRetryModel: () => void runReparse("model"),
          });
          return { settingsGroups: groups, settingsAccount: account };
        })()}
        onPurgeEmails={async (ids) => {
          for (const id of ids) await api(`/api/emails/${encodeURIComponent(id)}`, { method: "DELETE" });
          // 云端删掉了，本地列表也拿掉
          setLoad((current) => (current.state === "ready" ? { ...current, rows: current.rows.filter((r) => !ids.includes(r.id)) } : current));
        }}
        notice={[
          emailCount === 0 ? `还没有收到邮件（招聘邮件转发到 ${inbox} 就会出现在这里）` : `${emailCount} 封转发来的邮件`,
          "你的确认、忽略、手动添加存在云端，换设备也在。",
        ].join(" · ")}
        extractorNoteFor={(ids) => extractorNote(live.models, ids)}
        banner={
          // 顶上的一行行提醒，可以同时有好几条
          <>
            {reparse !== null ? (
              <div role="status" data-reparse-status className="mb-4 rounded-card border border-hairline bg-accent-soft px-4 py-3 text-sm text-ink">
                {reparse.text}
                {reparse.busy ? null : (
                  <button type="button" onClick={() => setReparse(null)} className="ml-2 text-xs underline underline-offset-2">
                    知道了
                  </button>
                )}
              </div>
            ) : null}
            {code ? (
              <div role="status" className="mb-4 rounded-card border border-hairline bg-accent-soft px-4 py-3 text-sm text-ink">
                Gmail 转发验证码：<span className="font-mono text-base font-semibold tabular">{code.code}</span>
                <span className="ml-2 text-xs">（在 Gmail「转发」设置里填入这个码，开通自动转发）</span>
              </div>
            ) : null}
            {otherConfirm ? (
              <div role="status" data-forwarding-banner className="mb-4 rounded-card border border-hairline bg-accent-soft px-4 py-3 text-sm text-ink">
                收到邮箱的转发确认信（{otherConfirm.subject}）：去「邮件」页最上面的「邮箱转发确认」点一下确认按钮，就开通了。
              </div>
            ) : null}
            {firstRun && !wizard.open && !code && !otherConfirm ? (
              <div role="status" data-setup-reminder className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-hairline bg-surface px-4 py-2.5 text-sm text-ink-soft">
                还没设自动转发，招聘邮件还进不来。
                <button type="button" onClick={() => setWizard((w) => ({ ...w, open: true }))} data-action="open-wizard" className="font-semibold text-on-brand-soft underline underline-offset-2">
                  去设置 →
                </button>
              </div>
            ) : null}
          </>
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
      {wizard.open ? (
        <SetupWizard
          emailCount={emailCount}
          confirmations={confirmations}
          viewerTimeZone={viewerTimeZone}
          onConfirmDone={confirmDone}
          onClose={closeWizard}
          page={wizard.page}
          onPage={(page) => setWizard((w) => ({ ...w, page }))}
          chosen={wizard.provider}
          onChoose={(provider) => setWizard((w) => ({ ...w, provider }))}
          onRefresh={() => refresh("manual")}
        />
      ) : null}
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
