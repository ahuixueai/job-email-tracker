import type { AgendaItem } from "./agenda";
import { alarmDuration, DEFAULT_PREFS } from "./boardPrefs";
import type { BoardPrefs } from "./boardPrefs";

/**
 * 日程 → 日历订阅（iCalendar / .ics）。Google 日历、苹果日历订阅这个链接，就能在手机日历里看到并收到提醒。
 *
 * 只放日程上有具体时刻的事（和看板「日程」里的一样，按你的确认、移出、编辑、完成叠过）：
 * - 准点开始的：开始时刻起 1 小时（提醒提前量见设置，默认 1 小时）
 * - 截止前完成的：截止前 30 分钟到截止，标题写「截止」
 * - 做完的：标题前加「✓」，不再提醒；标了「没参加」的不放
 * 内容只写公司、事件、岗位和看板链接，不写考试码、备注这些——日历会同步到 Google / iCloud。
 */

const HOUR = 3_600_000;

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 文本转义。 */
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** 每行不超过 75 个字节（UTF-8），超了折行，续行以一个空格开头。中文一个字 3 字节，不能按字符数切。 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** UID 只用安全字符：日历程序靠它认「同一件事」，改了时间也会更新原来那条而不是新建。 */
function uidOf(item: AgendaItem): string {
  return `${item.id.replace(/[^A-Za-z0-9._:-]/g, "_")}@interviewtrack.me`;
}

export function buildIcs(
  agenda: readonly AgendaItem[],
  nowMs: number,
  boardUrl: string,
  alarms: BoardPrefs["calendar"] = DEFAULT_PREFS.calendar,
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//interviewtrack//board//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:求职日程",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const item of agenda) {
    if (item.place !== "board" || item.result.when === null) continue;
    if (item.completion?.state === "missed") continue;
    const at = Date.parse(item.result.when.utc);
    if (!Number.isFinite(at)) continue;
    const deadline = item.result.dueType === "deadline";
    const start = deadline ? at - HOUR / 2 : at;
    const end = deadline ? at : at + HOUR;
    const done = item.completion?.state === "done";
    const company = item.result.displayCompany.length > 0 ? item.result.displayCompany : "公司未认出";
    const title = `${done ? "✓ " : ""}${deadline ? "截止：" : ""}${item.result.kindLabel} · ${company}`;
    const description = [item.result.role ? `岗位：${item.result.role}` : null, `详情：${boardUrl}`].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uidOf(item)}`,
      `DTSTAMP:${stamp(nowMs)}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      fold(`SUMMARY:${escapeText(title)}`),
      fold(`DESCRIPTION:${escapeText(description)}`),
      `URL:${boardUrl}`,
    );
    // 还没做、还没到的才提醒；提前多久按你在设置里选的（默认准点开始前 30 分钟、截止前 1 天），选了「不提醒」就不放
    const lead = deadline ? alarms.deadlineAlarm : alarms.fixedAlarm;
    if (!done && at > nowMs && lead !== null) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        // 截止的按截止时刻（事件的结束）往前算，不是按前面那半小时的开头
        deadline ? `TRIGGER;RELATED=END:${alarmDuration(lead)}` : `TRIGGER:${alarmDuration(lead)}`,
        fold(`DESCRIPTION:${escapeText(title)}`),
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
