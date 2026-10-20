import { useEffect, useState } from "react";
import { CalendarPlus, Check, Copy, LogOut } from "lucide-react";
import { ConfirmButton } from "@/components/demo/EventCard";
import { Section } from "@/components/demo/SettingsView";
import type { SettingsGroup } from "@/components/demo/SettingsView";
import { alarmLabel, DEADLINE_ALARM_CHOICES, DEFAULT_PREFS, FIXED_ALARM_CHOICES, parsePrefs } from "@/lib/demo/boardPrefs";
import type { BoardPrefs, TimeZonePrefs } from "@/lib/demo/boardPrefs";
import { formatWallClock } from "@/lib/demo/parseDemo";
import { ResumeSection } from "./ResumeSection";
import { senderText, useSession } from "./session";
import { TimeZoneSettings } from "./TimeZoneSettings";

/** 三天没收到新邮件就提醒：求职季里这么久一封都没有，多半是转发断了。 */
export const QUIET_DAYS = 3;

/** 收信可能出问题时的一句话；正常时为 null。按「进库时刻」算，导入的旧邮件不会让它误以为最近收到过。 */
export function healthWarning(lastStoredAt: string | null, nowMs: number): string | null {
  if (lastStoredAt === null) return null;
  const days = Math.floor((nowMs - Date.parse(lastStoredAt)) / 86_400_000);
  return days >= QUIET_DAYS ? `已经 ${days} 天没收到新邮件了，Gmail 转发可能断了。` : null;
}

/** `https://…/cal/x.ics` → 苹果日历认的 `webcal://…`、Google 日历的「通过网址添加」链接。 */
export function subscribeLinks(url: string): { webcal: string; google: string } {
  const webcal = url.replace(/^https?:\/\//, "webcal://");
  return { webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return [copied, copy];
}

function CopyRow({ value, label, data }: { value: string; label: string; data: string }) {
  const [copied, copy] = useCopy();
  return (
    <div className="flex items-center gap-2 rounded-xl border border-hairline bg-canvas px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink select-all" {...{ [data]: true }}>
        {value}
      </code>
      <button type="button" onClick={() => copy(value)} aria-label={label} className="shrink-0 rounded-lg p-1.5 text-ink-soft hover:bg-raised">
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}

const linkButton =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-85";

/** 日历与提醒：邮件提醒开关 + 一键订阅 + 提前多久提醒。 */
function CalendarSettings() {
  const { session } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<BoardPrefs | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [resetState, setResetState] = useState<"idle" | "done" | "failed">("idle");

  const resetLink = () => {
    fetch("/api/calendar/reset", { method: "POST", credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { url?: string };
        if (res.ok && body.url) {
          setUrl(body.url);
          setResetState("done");
        } else setResetState("failed");
      })
      .catch(() => setResetState("failed"));
  };

  useEffect(() => {
    let alive = true;
    fetch("/api/calendar", { credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!alive) return;
        if (res.ok && body.url) setUrl(body.url);
        else setError(body.error ?? `读取失败（${res.status}）`);
      })
      .catch(() => alive && setError("连不上服务器"));
    fetch("/api/prefs", { credentials: "same-origin" })
      .then((res) => res.json() as Promise<{ prefs?: unknown }>)
      .then((body) => alive && setPrefs(parsePrefs(body.prefs)))
      .catch(() => alive && setPrefs(DEFAULT_PREFS));
    return () => {
      alive = false;
    };
  }, []);

  const save = (calendar: BoardPrefs["calendar"]) => {
    setPrefs((current) => (current === null ? current : { ...current, calendar }));
    setSaveState("saving");
    // 只发日历这一块；时区那一块由「时区」设置管，服务器会保留没发的部分
    fetch("/api/prefs", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calendar }),
    }).then(
      (res) => setSaveState(res.ok ? "saved" : "failed"),
      () => setSaveState("failed"),
    );
  };

  const links = url ? subscribeLinks(url) : null;
  const select = "mt-1 w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink sm:w-48";
  return (
    <>
      <Section title="订阅到手机日历" hint="订阅一次就行，之后日历会自己来取最新的：你在看板上确认、移出、编辑、标完成，日历都会跟着变。">
        {links ? (
          <>
            <div className="flex flex-wrap gap-2">
              <a href={links.webcal} data-action="subscribe-apple" className={`${linkButton} bg-brand-soft text-on-brand-soft`}>
                <CalendarPlus size={15} aria-hidden />
                在 iPhone / Mac 上订阅
              </a>
              <a
                href={links.google}
                target="_blank"
                rel="noopener noreferrer"
                data-action="subscribe-google"
                className={`${linkButton} border border-hairline text-ink`}
              >
                <CalendarPlus size={15} aria-hidden />
                添加到 Google 日历
              </a>
            </div>
            <ul className="space-y-1 text-xs leading-relaxed text-ink-soft">
              <li>· iPhone / Mac：点按钮后系统会弹出「订阅日历」，确认即可。订阅页里如果有「移除提醒」，把它关掉，不然到点不会提醒。</li>
              <li>· Google：会打开 Google 日历网页版，点「添加」。Google 不一定按这里设的提醒响，要提醒的话在 Google 日历里给这个日历加通知。</li>
              <li>
                · 多久更新一次：iPhone 一般 15 分钟到 1 小时（「设置 → App → 日历 → 日历账户 → 获取新数据」里可调）；Mac 订阅时可选每 5 分钟；Google 几小时到一天，改不了。
              </li>
            </ul>
            <details className="text-xs text-ink-soft">
              <summary className="cursor-pointer text-ink-soft hover:text-ink">按钮没反应？手动订阅</summary>
              <div className="mt-2 space-y-2">
                <CopyRow value={url ?? ""} label="复制订阅链接" data="data-calendar-url" />
                <p className="leading-relaxed">
                  iPhone：设置 →（新版 iOS 先点「App」）日历 → 日历账户 → 添加账户 → 其他 → 添加已订阅的日历，粘贴这个链接。Google：电脑网页版左侧「其他日历」旁的 + → 通过网址添加。
                </p>
              </div>
            </details>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-ink-faint">这个链接等于你的日程本身，别发给别人。万一泄露了，换一个新链接，旧的立刻失效（之后要重新订阅一次）。</p>
              <ConfirmButton onConfirm={resetLink} confirmText="确认：旧链接作废" action="calendar-reset">
                换一个新链接
              </ConfirmButton>
            </div>
            {resetState !== "idle" ? (
              <p role={resetState === "failed" ? "alert" : "status"} className={`text-xs ${resetState === "failed" ? "text-on-drop-soft" : "text-ink-soft"}`} data-calendar-reset-status>
                {resetState === "done" ? "已换成新链接，旧链接已经作废。请用上面的按钮重新订阅一次。" : "没换成功，刷新后再试一次"}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-ink-faint">{error ?? "读取中…"}</p>
        )}
      </Section>

      <Section
        title="邮件提醒"
        hint="面试、笔试前一天晚上 8 点发一封，写明几点、怎么参加（链接、考试码、你的备注）；测评、网申截止前 24 小时和 3 小时各一封，标了完成就不再发。临开始前的提醒交给上面订阅的日历（提前多久见下面，默认 30 分钟）。"
      >
        {prefs ? (
          <div className="flex flex-wrap items-center gap-3" data-email-reminders={prefs.calendar.emailReminders ? "on" : "off"}>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.calendar.emailReminders}
              onClick={() => save({ ...prefs.calendar, emailReminders: !prefs.calendar.emailReminders })}
              data-action="toggle-email-reminders"
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${prefs.calendar.emailReminders ? "bg-brand-soft text-on-brand-soft" : "border border-hairline text-ink-soft"}`}
            >
              {prefs.calendar.emailReminders ? "邮件提醒已开启（点击关闭）" : "邮件提醒已关闭（点击开启）"}
            </button>
            {session ? <span className="text-xs text-ink-soft">发到 {session.email}</span> : null}
          </div>
        ) : (
          <p className="text-sm text-ink-faint">读取中…</p>
        )}
      </Section>

      <Section title="日历提前多久提醒" hint="写进订阅日历里的提醒。改了之后，日历下次自动更新时生效。">
        {prefs ? (
          <div className="flex flex-wrap gap-x-6 gap-y-3" data-alarm-prefs>
            <label className="block text-sm text-ink-soft">
              面试、笔试（准点开始）
              <select
                name="fixedAlarm"
                value={String(prefs.calendar.fixedAlarm)}
                onChange={(e) => save({ ...prefs.calendar, fixedAlarm: FIXED_ALARM_CHOICES.find((c) => String(c) === e.target.value) ?? null })}
                className={select}
              >
                {FIXED_ALARM_CHOICES.map((c) => (
                  <option key={String(c)} value={String(c)}>
                    {c === null ? "不提醒" : `提前 ${alarmLabel(c)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-ink-soft">
              测评、补材料（截止前完成）
              <select
                name="deadlineAlarm"
                value={String(prefs.calendar.deadlineAlarm)}
                onChange={(e) => save({ ...prefs.calendar, deadlineAlarm: DEADLINE_ALARM_CHOICES.find((c) => String(c) === e.target.value) ?? null })}
                className={select}
              >
                {DEADLINE_ALARM_CHOICES.map((c) => (
                  <option key={String(c)} value={String(c)}>
                    {c === null ? "不提醒" : `截止前 ${alarmLabel(c)}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="text-sm text-ink-faint">读取中…</p>
        )}
        {saveState !== "idle" ? (
          <p role={saveState === "failed" ? "alert" : "status"} data-prefs-status className={`text-xs ${saveState === "failed" ? "text-on-drop-soft" : "text-ink-soft"}`}>
            {{ saving: "保存中…", saved: "已保存。邮件提醒马上生效，日历下次自动更新时生效。", failed: "保存失败，刷新后再试一次" }[saveState]}
          </p>
        ) : null}
      </Section>
    </>
  );
}

/** 收信：地址、只收谁转来的、收信情况、怎么测一下。 */
function InboxSettings({
  emailCount,
  lastStoredAt,
  viewerTimeZone,
  nowMs,
  modelFailed,
  busy,
  onRetryModel,
}: {
  emailCount: number;
  lastStoredAt: string | null;
  viewerTimeZone: string;
  nowMs: number;
  modelFailed: number;
  busy: boolean;
  onRetryModel: () => void;
}) {
  const { session } = useSession();
  const sender = senderText(session.forwarders);
  const warning = healthWarning(lastStoredAt, nowMs);
  return (
    <>
      <Section title="收信地址" hint="这个地址只属于你，别公开贴出去。">
        <CopyRow value={session.inbox} label="复制收信地址" data="data-settings-inbox" />
        <p className="text-xs leading-relaxed text-ink-soft">
          只收从 <strong className="font-semibold text-ink">{sender}</strong> 转来的信，别的邮箱发来的会被拒收。怎么转发，见「邮件」页顶上的教程。
        </p>
      </Section>

      <ForwardersEditor />

      <Section title="收信情况">
        {warning ? (
          <p role="alert" className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-ink" data-settings-warning>
            {warning} 去 Gmail「设置 → 过滤器和屏蔽的地址」看看转发过滤器还在不在，或用下面的方法测一下。
          </p>
        ) : null}
        <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-hairline bg-canvas px-4 py-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-ink-soft">最近收到</dt>
          <dd className="tabular text-ink" data-last-email>
            {lastStoredAt === null ? "还没有" : formatWallClock(lastStoredAt, viewerTimeZone)}
          </dd>
          <dt className="text-ink-soft">一共收到</dt>
          <dd className="tabular text-ink">{emailCount} 封</dd>
        </dl>
        {modelFailed > 0 ? (
          <div className="flex flex-wrap items-center gap-2" data-model-failed>
            <p className="text-xs leading-relaxed text-ink-soft">
              有 <strong className="font-semibold text-ink">{modelFailed}</strong> 封信收到时 AI 没响应，只用了规则解析，公司名可能没认出。
            </p>
            <button
              type="button"
              onClick={onRetryModel}
              disabled={busy}
              data-action="retry-model"
              className="rounded-lg border border-hairline px-3 py-1.5 text-sm text-ink-soft hover:bg-raised disabled:opacity-50"
            >
              {busy ? "处理中…" : `用 AI 重新解析这 ${modelFailed} 封`}
            </button>
          </div>
        ) : null}
      </Section>

      {session.role === "owner" ? <MonitorSection /> : null}

      <Section title="测一下收信通不通">
        <p className="text-xs leading-relaxed text-ink-soft" data-test-mail>
          用 {sender} 给 {session.inbox} 发一封信（新写一封，不是转发，内容随便），一分钟后回看板点「刷新」：它会出现在「邮件」页底下的「已忽略」里，标着「你自己发出的信」。看到它就说明收信是通的；它不会进日程，也不调用 AI。
        </p>
      </Section>
    </>
  );
}

/** 除登录邮箱外，还允许哪些邮箱转信进来（比如登录用学校邮箱、转信用 Gmail）。 */
function ForwardersEditor() {
  const { session, reload } = useSession();
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"idle" | "saving" | string>("idle");
  const save = (list: string[]) => {
    setState("saving");
    fetch("/api/account/forwarders", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ list }),
    })
      .then(async (res) => {
        if (!res.ok) {
          setState(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `保存失败（${res.status}）`);
          return;
        }
        setDraft("");
        await reload();
        setState("idle");
      })
      .catch(() => setState("连不上服务器"));
  };
  const extras = session.extraForwarders;
  const full = extras.length >= session.maxExtraForwarders;
  return (
    <Section title="用别的邮箱转信" hint={`登录邮箱（${session.email}）转来的信一定收。登录用的不是你收招聘邮件的那个邮箱时，在这里加上它，最多 ${session.maxExtraForwarders} 个。`}>
      {extras.length > 0 ? (
        <ul className="space-y-1.5" data-extra-forwarders>
          {extras.map((address) => (
            <li key={address} className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm text-ink">
              <span className="min-w-0 truncate">{address}</span>
              <button
                type="button"
                onClick={() => save(extras.filter((a) => a !== address))}
                disabled={state === "saving"}
                data-action="remove-forwarder"
                className="shrink-0 text-xs text-ink-soft underline underline-offset-2 disabled:opacity-50"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {full ? null : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim().length > 0) save([...extras, draft.trim()]);
          }}
        >
          <input
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="name@gmail.com"
            aria-label="加一个转信邮箱"
            data-forwarder-input
            className="w-full rounded-lg border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink sm:w-64"
          />
          <button
            type="submit"
            disabled={state === "saving" || draft.trim().length === 0}
            data-action="add-forwarder"
            className="rounded-lg border border-hairline px-3 py-1.5 text-sm text-ink-soft hover:bg-raised disabled:opacity-50"
          >
            {state === "saving" ? "保存中…" : "加上"}
          </button>
        </form>
      )}
      {state !== "idle" && state !== "saving" ? (
        <p role="alert" className="text-xs text-on-drop-soft" data-forwarder-error>
          {state}
        </p>
      ) : null}
    </Section>
  );
}

/** AI 开关与今天的用量。关掉后：新来的信只用规则解析，一句话添加不认公司名，面试准备不可用。 */
function AiSettings() {
  const { session, reload } = useSession();
  const [state, setState] = useState<"idle" | "saving" | string>("idle");
  const { enabled, usedToday, dailyLimit } = session.ai;
  const toggle = () => {
    setState("saving");
    fetch("/api/account/ai", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    })
      .then(async (res) => {
        if (!res.ok) {
          setState(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `保存失败（${res.status}）`);
          return;
        }
        await reload();
        setState("idle");
      })
      .catch(() => setState("连不上服务器"));
  };
  return (
    <Section
      title="用 AI 帮忙"
      hint="开着时，收到的信会交给 AI（DeepSeek，在中国境内处理）摘出公司、岗位、时间片段；一句话添加、面试准备也靠它。关掉后只用规则：时间照样算，公司名可能认不出。"
    >
      <div className="flex flex-wrap items-center gap-3" data-ai-settings={enabled ? "on" : "off"}>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          disabled={state === "saving"}
          data-action="toggle-ai"
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${enabled ? "bg-brand-soft text-on-brand-soft" : "border border-hairline text-ink-soft"}`}
        >
          {enabled ? "AI 已开启（点击关闭）" : "AI 已关闭（点击开启）"}
        </button>
        <span className="text-xs text-ink-soft tabular" data-ai-usage>
          今天用了 {usedToday} 次{dailyLimit === null ? "（不限）" : ` / 每天 ${dailyLimit} 次`}
        </span>
      </div>
      {dailyLimit !== null ? (
        <p className="text-xs text-ink-faint">内测期间每人每天最多 {dailyLimit} 次（收一封信、一句话添加、面试准备各算一次），用完当天只用规则，第二天恢复。</p>
      ) : null}
      {state !== "idle" && state !== "saving" ? (
        <p role="alert" className="text-xs text-on-drop-soft">
          {state}
        </p>
      ) : null}
    </Section>
  );
}

/** 出问题时自动提醒：现在查到的问题 + 发一封测试提醒。 */
function MonitorSection() {
  const [info, setInfo] = useState<{ problems: { key: string; text: string }[]; alertTo: string | null } | null>(null);
  const [test, setTest] = useState<"idle" | "sending" | "sent" | string>("idle");
  useEffect(() => {
    let alive = true;
    fetch("/api/monitor", { credentials: "same-origin" })
      .then((res) => (res.ok ? (res.json() as Promise<{ problems: { key: string; text: string }[]; alertTo: string | null }>) : null))
      .then((body) => alive && body && setInfo(body))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const sendTest = () => {
    setTest("sending");
    fetch("/api/monitor/test", { method: "POST", credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setTest(res.ok ? "sent" : (body.error ?? `发送失败（${res.status}）`));
      })
      .catch(() => setTest("连不上服务器"));
  };
  return (
    <Section
      title="出问题时提醒你"
      hint={`每 6 小时自动检查一次：AI 解析失败多、3 天没收到新邮件、有信处理出错，就发一封提醒到 ${info?.alertTo ?? "你的登录邮箱"}。同一个问题 24 小时内只提醒一次。`}
    >
      {info && info.problems.length > 0 ? (
        <ul className="space-y-1.5 rounded-xl bg-accent-soft px-4 py-3 text-sm text-ink" data-monitor-problems>
          {info.problems.map((p) => (
            <li key={p.key}>· {p.text}</li>
          ))}
        </ul>
      ) : info ? (
        <p className="text-xs text-ink-soft" data-monitor-ok>
          现在没查到问题。
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={sendTest}
          disabled={test === "sending"}
          data-action="monitor-test"
          className="rounded-lg border border-hairline px-3 py-1.5 text-sm text-ink-soft hover:bg-raised disabled:opacity-50"
        >
          {test === "sending" ? "发送中…" : "发一封测试提醒"}
        </button>
        {test !== "idle" && test !== "sending" ? (
          <span role={test === "sent" ? "status" : "alert"} data-monitor-test-status className={`text-xs ${test === "sent" ? "text-ink-soft" : "text-on-drop-soft"}`}>
            {test === "sent" ? "已发出，去邮箱看看（可能在「更新」或垃圾邮件里）" : test}
          </span>
        ) : null}
      </div>
    </Section>
  );
}

function AccountSettings({ onSignOut }: { onSignOut: () => void }) {
  const { session } = useSession();
  return (
    <Section title="账号">
      <p className="text-sm text-ink-soft" data-account-email>
        登录邮箱：<span className="text-ink">{session.email}</span>
        <span className="mt-0.5 block text-xs text-ink-faint">
          {session.role === "owner" ? "登录时验证码发到这个邮箱；收不到时可以用看板密码登录（备用）。" : "登录时验证码发到这个邮箱。"}
        </span>
      </p>
      <button
        type="button"
        onClick={onSignOut}
        data-action="sign-out"
        className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm text-ink-soft hover:bg-raised"
      >
        <LogOut size={14} aria-hidden /> 退出登录
      </button>
      <p className="text-xs text-ink-faint">
        我们存了什么、交给了谁、能保留多久，见
        <a href="/privacy" target="_blank" rel="noopener" data-privacy-link className="underline underline-offset-2 hover:text-ink-soft">
          隐私政策与使用条款
        </a>
        。
      </p>
      <DeleteAllData onDeleted={onSignOut} />
    </Section>
  );
}

/** 删除我的账号和数据：要手打确认语。删完退出登录。只删自己的，别人的不动。 */
function DeleteAllData({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "deleting" | string>("idle");
  const CONFIRM = "删除全部数据";
  const run = () => {
    setState("deleting");
    fetch("/api/account/delete", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: text }),
    })
      .then(async (res) => {
        if (res.ok) onDeleted();
        else setState(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `删除失败（${res.status}）`);
      })
      .catch(() => setState("连不上服务器，什么都没删"));
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-action="delete-all-open" className="text-xs text-on-drop-soft underline underline-offset-2">
        删除我的账号和数据…
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-hairline bg-canvas px-4 py-3" data-delete-all>
      <p className="text-sm font-semibold text-ink">删除我的账号和数据</p>
      <ul className="space-y-0.5 text-xs leading-relaxed text-ink-soft">
        <li>· 立即删掉：所有邮件和解析结论、你的确认和编辑、简历、时区与提醒设置、账号本身。撤销不了。</li>
        <li>· 日历订阅会失效；数据库的自动备份最多再留 30 天，之后彻底消失。</li>
        <li>· 新的招聘邮件还会转发过来，要停的话先去 Gmail 关掉转发过滤器。</li>
      </ul>
      <label className="block text-xs text-ink-soft">
        输入「{CONFIRM}」确认
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-delete-confirm
          className="mt-1 w-full rounded-lg border border-hairline bg-surface px-3 py-1.5 text-sm text-ink sm:w-64"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={text !== CONFIRM || state === "deleting"}
          data-action="delete-all"
          className="rounded-lg bg-drop-soft px-3 py-1.5 text-sm font-semibold text-on-drop-soft disabled:opacity-40"
        >
          {state === "deleting" ? "删除中…" : "永久删除"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-soft underline underline-offset-2">
          算了
        </button>
        {state !== "idle" && state !== "deleting" ? (
          <span role="alert" className="text-xs text-on-drop-soft">
            {state}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 「设置」里私人看板才有的几组；演示站没有这些（没有云端、没有账号）。
 * 「数据与账号」那一组两边都有，这里只补上退出登录。
 */
export function privateSettings(props: {
  emailCount: number;
  lastStoredAt: string | null;
  viewerTimeZone: string;
  nowMs: number;
  onSignOut: () => void;
  zones: TimeZonePrefs;
  deviceZone: string;
  onSaveZones: (zones: TimeZonePrefs) => Promise<void>;
  reparse: string | null;
  modelFailed: number;
  reparseBusy: boolean;
  onRetryModel: () => void;
}): { groups: SettingsGroup[]; account: React.ReactNode } {
  return {
    groups: [
      {
        id: "timezones",
        title: "时区",
        content: <TimeZoneSettings zones={props.zones} deviceZone={props.deviceZone} onSave={props.onSaveZones} reparse={props.reparse} />,
      },
      { id: "calendar", title: "日历与提醒", content: <CalendarSettings /> },
      {
        id: "inbox",
        title: "收信",
        content: (
          <InboxSettings
            emailCount={props.emailCount}
            lastStoredAt={props.lastStoredAt}
            viewerTimeZone={props.viewerTimeZone}
            nowMs={props.nowMs}
            modelFailed={props.modelFailed}
            busy={props.reparseBusy}
            onRetryModel={props.onRetryModel}
          />
        ),
      },
      {
        id: "ai",
        title: "AI 与简历",
        content: (
          <>
            <AiSettings />
            <ResumeSection viewerTimeZone={props.viewerTimeZone} />
          </>
        ),
      },
    ],
    account: <AccountSettings onSignOut={props.onSignOut} />,
  };
}
