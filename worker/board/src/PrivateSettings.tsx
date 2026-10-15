import { useEffect, useState } from "react";
import { CalendarPlus, Check, Copy, LogOut } from "lucide-react";
import { ConfirmButton } from "@/components/demo/EventCard";
import { Section } from "@/components/demo/SettingsView";
import type { SettingsGroup } from "@/components/demo/SettingsView";
import { alarmLabel, DEADLINE_ALARM_CHOICES, DEFAULT_PREFS, FIXED_ALARM_CHOICES, parsePrefs } from "@/lib/demo/boardPrefs";
import type { BoardPrefs } from "@/lib/demo/boardPrefs";
import { formatWallClock } from "@/lib/demo/parseDemo";
import { INBOX_ADDRESS, useForwarders, useSessionInfo } from "./EmailGuide";
import { ResumeSection } from "./ResumeSection";

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

/** 日历与提醒：一键订阅 + 提前多久提醒。 */
function CalendarSettings() {
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
    const next: BoardPrefs = { version: 1, calendar };
    setPrefs(next);
    setSaveState("saving");
    fetch("/api/prefs", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
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

      <Section title="提前多久提醒" hint="写进订阅日历里的提醒。改了之后，日历下次自动更新时生效。">
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
            {{ saving: "保存中…", saved: "已保存。日历下次自动更新时生效。", failed: "保存失败，刷新后再试一次" }[saveState]}
          </p>
        ) : null}
      </Section>
    </>
  );
}

/** 收信：地址、只收谁转来的、收信情况、怎么测一下。 */
function InboxSettings({ emailCount, lastStoredAt, viewerTimeZone, nowMs }: { emailCount: number; lastStoredAt: string | null; viewerTimeZone: string; nowMs: number }) {
  const forwarders = useForwarders();
  const sender = forwarders && forwarders.length > 0 ? forwarders.join("、") : "你设置的 Gmail";
  const warning = healthWarning(lastStoredAt, nowMs);
  return (
    <>
      <Section title="收信地址">
        <CopyRow value={INBOX_ADDRESS} label="复制收信地址" data="data-settings-inbox" />
        <p className="text-xs leading-relaxed text-ink-soft">
          只收从 <strong className="font-semibold text-ink">{sender}</strong> 转来的信，别的邮箱发来的会被拒收。怎么转发，见「邮件」页顶上的教程。
        </p>
      </Section>

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
      </Section>

      <Section title="测一下收信通不通">
        <p className="text-xs leading-relaxed text-ink-soft" data-test-mail>
          用 {sender} 给 {INBOX_ADDRESS} 发一封信（新写一封，不是转发，内容随便），一分钟后回看板点「刷新」：它会出现在「邮件」页底下的「已忽略」里，标着「你自己发出的信」。看到它就说明收信是通的；它不会进日程，也不调用 AI。
        </p>
      </Section>
    </>
  );
}

function AccountSettings({ onSignOut }: { onSignOut: () => void }) {
  const info = useSessionInfo();
  return (
    <Section title="账号">
      <p className="text-sm text-ink-soft" data-account-email>
        登录邮箱：<span className="text-ink">{info?.email ?? "…"}</span>
        <span className="mt-0.5 block text-xs text-ink-faint">登录时验证码发到这个邮箱；收不到时可以用看板密码登录（备用）。</span>
      </p>
      <button
        type="button"
        onClick={onSignOut}
        data-action="sign-out"
        className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm text-ink-soft hover:bg-raised"
      >
        <LogOut size={14} aria-hidden /> 退出登录
      </button>
    </Section>
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
}): { groups: SettingsGroup[]; account: React.ReactNode } {
  return {
    groups: [
      { id: "calendar", title: "日历与提醒", content: <CalendarSettings /> },
      {
        id: "inbox",
        title: "收信",
        content: <InboxSettings emailCount={props.emailCount} lastStoredAt={props.lastStoredAt} viewerTimeZone={props.viewerTimeZone} nowMs={props.nowMs} />,
      },
      { id: "ai", title: "AI 与简历", content: <ResumeSection viewerTimeZone={props.viewerTimeZone} /> },
    ],
    account: <AccountSettings onSignOut={props.onSignOut} />,
  };
}
