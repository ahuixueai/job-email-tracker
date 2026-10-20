import type { AgendaItem } from "../../web/lib/demo/agenda";
import { reminderZone } from "../../web/lib/demo/boardPrefs";
import { formatWallClock, zoneLabel } from "../../web/lib/demo/parseDemo";
import { inboxDomain } from "./accounts.js";
import { loadAgenda } from "./agendaData.js";
import { systemSender } from "./inbox.js";
import type { Env } from "./types.js";

/**
 * 邮件提醒（10/19 作者定）：
 * - 面试、笔试这类准点开始的：前一天晚上 8 点（你所在地的时间）发一封，写清楚几点、怎么参加；
 *   当天才收到的、或者晚上 8 点以后才进来的，进来就发（离开始不到 30 分钟就不发了，那一下交给日历）。
 * - 测评、网申这类截止的：截止前 24 小时一封、3 小时一封；标了完成就不再发。
 * - 开始前 30 分钟的提醒在订阅日历里，邮件不管。
 * 同一次检查里该发的合成一封，省发信额度（登录验证码也从这里出）。
 */

export type ReminderKind = "eve" | "due24" | "due3";

export interface Reminder {
  kind: ReminderKind;
  item: AgendaItem;
  /** 发过没有按它记：事件时间改了，键就变了，会按新时间再提醒。 */
  key: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 前一天晚上几点发。 */
const EVE_HOUR = 20;
/** 离开始不到这么久就不发邮件了：日历会在开始前 30 分钟响。 */
const TOO_LATE_BEFORE_START = 30 * MINUTE;
const MAX_NOTE_CHARS = 600;

export function reminderKey(item: AgendaItem, kind: ReminderKind): string {
  return `${item.id}|${kind}|${item.result.when?.utc ?? ""}`;
}

/** 某个时区里的年月日。 */
function localDate(ms: number, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** 这个时区在这一刻比 UTC 快多少毫秒。 */
function zoneOffset(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - (ms - (ms % 1000));
}

/** 事件那天的前一天、当地晚上 8 点，是哪一刻。 */
export function eveSendAt(startMs: number, timeZone: string): number {
  const { y, m, d } = localDate(startMs, timeZone);
  const guess = Date.UTC(y, m - 1, d - 1, EVE_HOUR, 0);
  // 夏令时切换那天两次修正就够
  const first = guess - zoneOffset(guess, timeZone);
  return guess - zoneOffset(first, timeZone);
}

/** 这一刻该发哪些提醒。sent 是已经发过的键。 */
export function pickReminders(agenda: readonly AgendaItem[], nowMs: number, homeZone: string, sent: ReadonlySet<string>): Reminder[] {
  const out: Reminder[] = [];
  const add = (item: AgendaItem, kind: ReminderKind) => {
    const key = reminderKey(item, kind);
    if (!sent.has(key)) out.push({ kind, item, key });
  };
  for (const item of agenda) {
    if (item.place !== "board" || item.result.when === null) continue;
    if (item.completion !== null) continue; // 标了完成或没参加的都不提醒
    const at = Date.parse(item.result.when.utc);
    if (!Number.isFinite(at) || at <= nowMs) continue;
    if (item.result.dueType === "deadline") {
      if (at - nowMs <= 3 * HOUR) add(item, "due3");
      else if (at - nowMs <= 24 * HOUR) add(item, "due24");
    } else if (nowMs >= eveSendAt(at, homeZone) && at - nowMs > TOO_LATE_BEFORE_START) {
      add(item, "eve");
    }
  }
  return out.sort((a, b) => Date.parse(a.item.result.when?.utc ?? "") - Date.parse(b.item.result.when?.utc ?? ""));
}

function company(item: AgendaItem): string {
  return item.result.displayCompany.length > 0 ? item.result.displayCompany : "公司未认出";
}

/** 「今天 / 明天 / 10月22日 周四」+ 钟点。只有日期的不写钟点。 */
function whenText(item: AgendaItem, nowMs: number, homeZone: string): string {
  const utc = item.result.when?.utc ?? "";
  const full = formatWallClock(utc, homeZone);
  const [datePart = full, clock = ""] = [full.slice(0, full.lastIndexOf(" ")), full.slice(full.lastIndexOf(" ") + 1)];
  const day = localDate(Date.parse(utc), homeZone);
  const today = localDate(nowMs, homeZone);
  const tomorrow = localDate(nowMs + 24 * HOUR, homeZone);
  const same = (a: typeof day, b: typeof day) => a.y === b.y && a.m === b.m && a.d === b.d;
  const dayText = same(day, today) ? "今天" : same(day, tomorrow) ? "明天" : datePart;
  return item.result.dueType === "date_only" ? `${dayText}（信里没写钟点）` : `${dayText} ${clock}`;
}

function headline(r: Reminder, nowMs: number, homeZone: string): string {
  const what = `${r.item.result.kindLabel} · ${company(r.item)}`;
  const when = whenText(r.item, nowMs, homeZone);
  if (r.kind === "due3") return `3 小时内截止（${when}）：${what}`;
  if (r.kind === "due24") return `${when} 截止：${what}`;
  return `${when} ${what}`;
}

export interface ReminderMail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface Block {
  title: string;
  rows: { label: string; value: string; href?: string }[];
}

function blockOf(r: Reminder, nowMs: number, homeZone: string): Block {
  const result = r.item.result;
  const utc = result.when?.utc ?? "";
  const rows: Block["rows"] = [];
  const time = whenText(r.item, nowMs, homeZone);
  rows.push({ label: result.dueType === "deadline" ? "截止" : "时间", value: `${time}（${zoneLabel(homeZone)}）` });
  if (result.timeZone !== null && result.timeZone !== homeZone && result.dueType !== "date_only") {
    rows.push({ label: "当地", value: `${formatWallClock(utc, result.timeZone)}（${zoneLabel(result.timeZone)}）` });
  }
  if (result.role) rows.push({ label: "岗位", value: result.role });
  for (const link of result.links.slice(0, 3)) rows.push({ label: "链接", value: link, href: link });
  for (const c of result.credentials) rows.push({ label: c.label, value: c.value });
  if (r.item.note) {
    const note = r.item.note.length > MAX_NOTE_CHARS ? `${r.item.note.slice(0, MAX_NOTE_CHARS)}…（全文在准点里）` : r.item.note;
    rows.push({ label: "你的备注", value: note });
  }
  return { title: headline(r, nowMs, homeZone), rows };
}

const FOOTER = [
  "这封提醒由准点按你的日程发出：面试、笔试前一天晚上 8 点；测评、网申截止前 24 小时和 3 小时（标了完成就不再发）。",
  "临开始前的提醒在订阅日历里（默认提前 30 分钟）。不想收邮件提醒：准点「设置 → 日历与提醒」里关掉。",
];

export function composeReminderMail(reminders: readonly Reminder[], nowMs: number, homeZone: string, boardUrl: string): ReminderMail {
  const blocks = reminders.map((r) => blockOf(r, nowMs, homeZone));
  const first = blocks[0]?.title ?? "";
  const subject = blocks.length === 1 ? first : `${first} 等 ${blocks.length} 件事`;

  const text = [
    ...blocks.flatMap((b) => [`■ ${b.title}`, ...b.rows.map((row) => `  ${row.label}：${row.value}`), ""]),
    `在准点里看：${boardUrl}`,
    "",
    ...FOOTER,
  ].join("\n");

  const rowHtml = (row: Block["rows"][number]) =>
    `<tr><td style="padding:3px 12px 3px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${escapeHtml(row.label)}</td><td style="padding:3px 0;color:#111827;word-break:break-all">${
      row.href ? `<a href="${escapeHtml(row.href)}" style="color:#1d4ed8">${escapeHtml(row.value)}</a>` : escapeHtml(row.value).replace(/\n/g, "<br>")
    }</td></tr>`;
  const html = `<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.6;color:#111827;max-width:560px">
${blocks
  .map(
    (b) => `<div style="border:1px solid #e5e7eb;border-left:4px solid #f5b800;border-radius:8px;padding:12px 16px;margin:0 0 12px">
<div style="font-size:16px;font-weight:600;margin:0 0 6px">${escapeHtml(b.title)}</div>
<table style="border-collapse:collapse;font-size:14px">${b.rows.map(rowHtml).join("")}</table>
</div>`,
  )
  .join("\n")}
<p style="margin:16px 0"><a href="${escapeHtml(boardUrl)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px">在准点里看</a></p>
<p style="color:#6b7280;font-size:12px;margin:0">${FOOTER.map(escapeHtml).join("<br>")}</p>
</div>`;
  return { subject, text, html };
}

const KEEP_SENT_MS = 30 * 24 * HOUR;

export interface ReminderRun {
  /** 发了几封（一人一封）。 */
  mails: number;
  /** 一共提醒了几件事。 */
  items: number;
  failed: number;
}

/**
 * 每 15 分钟跑一次：挨个看每个人这一刻该收哪些提醒，合成一封发到登录邮箱，记下发过的。
 * 发信失败的不记，下一次再试。一个人出错不影响别人。
 */
export async function runReminders(env: Env, nowMs: number): Promise<ReminderRun> {
  const run: ReminderRun = { mails: 0, items: 0, failed: 0 };
  if (!env.EMAIL) return run;
  await env.DB.prepare("DELETE FROM reminders_sent WHERE sent_at < ?").bind(new Date(nowMs - KEEP_SENT_MS).toISOString()).run();
  const users = await env.DB.prepare("SELECT id, email FROM users").all<{ id: string; email: string }>();
  const boardUrl = `https://board.${inboxDomain(env)}`;
  for (const user of users.results) {
    try {
      const { agenda, prefs } = await loadAgenda(env, user.id);
      if (!prefs.calendar.emailReminders) continue;
      const zone = reminderZone(prefs);
      const sentRows = await env.DB.prepare("SELECT key FROM reminders_sent WHERE user_id = ?").bind(user.id).all<{ key: string }>();
      const due = pickReminders(agenda, nowMs, zone, new Set(sentRows.results.map((r) => r.key)));
      if (due.length === 0) continue;
      const mail = composeReminderMail(due, nowMs, zone, boardUrl);
      await env.EMAIL.send({ from: { email: systemSender(env), name: "准点提醒" }, to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
      const at = new Date(nowMs).toISOString();
      for (const r of due) {
        await env.DB.prepare("INSERT OR IGNORE INTO reminders_sent (user_id, key, sent_at) VALUES (?, ?, ?)").bind(user.id, r.key, at).run();
      }
      run.mails += 1;
      run.items += due.length;
    } catch (error) {
      run.failed += 1;
      console.log(JSON.stringify({ reminderFailed: { user: user.id, error: error instanceof Error ? error.message : String(error) } }));
    }
  }
  return run;
}
