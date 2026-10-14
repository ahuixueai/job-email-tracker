import type { AgendaItem, Place } from "./agenda";
import { formatWallClock } from "./parseDemo";
import type { DemoResult } from "./parseDemo";
import type { ApplicationPatch, Round, Stage, UserEdits } from "./userEdits";

/**
 * 「投递」表的视图模型：一家公司一行，状态从这家公司的全部邮件里推出来。
 *
 * 对应作者原先在飞书多维表格里手工维护的「已投递岗位」表——公司、岗位、当前状态、
 * 工作地点、下一步、下次跟进。区别是这里的状态不用手填：收到测评邀请就是「测评」，
 * 收到面试通知就是「面试」，收到拒信就是「未通过」。手动改过的以手动为准。
 *
 * ⚠️ 这里的推断只是**把引擎已经判好的事件类型排个先后**，不重新读邮件判类型。
 * 只有两处直接看原文：面试是第几面、结果是录用还是拒信——引擎目前不区分这两样，
 * 等它区分了，这两个函数应当搬进引擎。
 */

export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  applied: "已投递",
  materials: "待补材料",
  assessment: "测评",
  interview: "面试",
  offer: "Offer",
  rejected: "未通过",
};

/** 走得越远数字越大。未通过是终局，排在最后只是为了「取最大」时能盖过别的。 */
const STAGE_RANK: Readonly<Record<Stage, number>> = {
  applied: 1,
  materials: 2,
  assessment: 3,
  interview: 4,
  offer: 5,
  rejected: 6,
};

/** 漏斗用：这家公司最远走到了哪一步（不含「未通过」——那是结局，不是进度）。 */
export type Reach = "applied" | "assessment" | "interview" | "offer";

const REACH_RANK: Readonly<Record<Reach, number>> = { applied: 1, assessment: 2, interview: 3, offer: 4 };

const ROUND_RANK: Readonly<Record<Round, number>> = { 一面: 1, 二面: 2, 三面: 3, 终面: 4 };

/**
 * 面试是第几面。只认明写出来的轮次；「电话初筛」「视频面试」这类只说了形式的不猜。
 * 终面先判——「终面（三面）」应当算终面。
 */
export function interviewRound(text: string): Round | null {
  if (/终面|终试|最终面试|final[-\s]?round|final\s+interview|\bsuperday\b/i.test(text)) return "终面";
  if (/三面|第三轮|第3轮|third[-\s]?round|3rd[-\s]?round/i.test(text)) return "三面";
  if (/二面|复试|复面|第二轮|第2轮|second[-\s]?round|2nd[-\s]?round/i.test(text)) return "二面";
  if (/一面|初面|初试|第一轮|第1轮|first[-\s]?round|1st[-\s]?round/i.test(text)) return "一面";
  return null;
}

/**
 * 结果通知是录用还是拒信。拒信先判：拒信里常有「感谢」「祝好」，录用通知里不会有「遗憾」。
 * 两边都认不出时返回 null——表里如实写「有结果」，让用户点开看，不猜。
 */
export function resultKind(text: string): "offer" | "rejected" | null {
  if (
    /遗憾|很抱歉|未通过|未能通过|暂不匹配|无法进入|不再推进|不予录用|regret|not\s+(?:be\s+)?(?:moving|proceeding)\s+forward|unable\s+to\s+offer|unsuccessful/i.test(
      text,
    )
  ) {
    return "rejected";
  }
  if (/录用|offer|恭喜|congratulations|pleased\s+to\s+(?:offer|extend)/i.test(text)) return "offer";
  return null;
}

/** 喂给投递表的一封邮件。 */
export interface ApplicationEmail {
  sampleId: string;
  subject: string;
  body: string;
  receivedAtUtc: string;
  result: DemoResult;
  /** 这封邮件说的那件事，现在摆在哪（已经叠加了用户的决定）。 */
  place: Place;
}

export interface ApplicationRow {
  key: string;
  company: string;
  role: string | null;
  location: string | null;
  stage: Stage;
  /** 面试轮次。不是面试阶段、或信里没写时为 null。 */
  round: Round | null;
  /** 状态是用户手动改的。 */
  manualStage: boolean;
  /** 收到过结果通知，但认不出是录用还是拒信。 */
  resultUnclear: boolean;
  reach: Reach;
  /** 下一件要做的事。没有时为 null。dateOnly：只有「哪天跟进」（`YYYY-MM-DD`），没有钟点。 */
  next: { label: string; utc: string | null; isDeadline: boolean; dateOnly?: string } | null;
  /** 跟进日期已经到了（或过了）。 */
  followUpDue: boolean;
  /** 你的备注。 */
  note: string | null;
  /** 你在「编辑」里改过这一行（不含只改状态）。 */
  edited: boolean;
  /** 最早一封邮件的时刻（近似投递日期）；手动添加的取用户填的日期。没有为 null。 */
  firstSeenUtc: string | null;
  lastSeenUtc: string | null;
  emailIds: readonly string[];
  /** 这家公司还有几件事在等用户确认。 */
  pendingCount: number;
  origin: "email" | "manual";
}

/** 表格单元里显示的状态文字。 */
export function stageText(row: Pick<ApplicationRow, "stage" | "round">): string {
  if (row.stage === "interview" && row.round !== null) return `面试 · ${row.round}`;
  return STAGE_LABEL[row.stage];
}

interface Evidence {
  stage: Stage;
  round: Round | null;
  unclearResult: boolean;
}

/** 一封邮件能证明这家公司走到了哪一步。证明不了什么的返回 null。 */
function evidenceOf(email: ApplicationEmail): Evidence | null {
  const text = `${email.subject} ${email.body}`;
  switch (email.result.eventType) {
    case "application_ok":
      return { stage: "applied", round: null, unclearResult: false };
    case "update":
      return { stage: "materials", round: null, unclearResult: false };
    case "assessment":
      return { stage: "assessment", round: null, unclearResult: false };
    case "interview":
      return { stage: "interview", round: interviewRound(text), unclearResult: false };
    case "result": {
      const kind = resultKind(text);
      if (kind === "offer") return { stage: "offer", round: null, unclearResult: false };
      if (kind === "rejected") return { stage: "rejected", round: null, unclearResult: false };
      return { stage: "applied", round: null, unclearResult: true };
    }
    default:
      return null;
  }
}

function reachOf(stage: Stage, previous: Reach): Reach {
  const candidate: Reach =
    stage === "offer" ? "offer" : stage === "interview" ? "interview" : stage === "assessment" ? "assessment" : "applied";
  return REACH_RANK[candidate] > REACH_RANK[previous] ? candidate : previous;
}

function companyKey(result: DemoResult): string {
  const name = result.company.trim().length > 0 ? result.company : result.displayCompany;
  return name.trim().toLowerCase();
}

/** 「下一步」那一格的文字。 */
export function nextText(row: ApplicationRow, viewerTimeZone: string): string {
  if (row.next !== null) {
    if (row.next.dateOnly !== undefined) {
      return `${row.next.label} · ${Number(row.next.dateOnly.slice(5, 7))}月${Number(row.next.dateOnly.slice(8, 10))}日跟进`;
    }
    if (row.next.utc === null) return `${row.next.label}（没有具体时间）`;
    const when = formatWallClock(row.next.utc, viewerTimeZone);
    return `${row.next.label} · ${when}${row.next.isDeadline ? " 前" : ""}`;
  }
  if (row.pendingCount > 0) return `有 ${row.pendingCount} 件事等你确认`;
  if (row.stage === "applied") return "等待筛选结果";
  if (row.stage === "materials") return "按邮件要求补充材料";
  if (row.stage === "assessment" || row.stage === "interview") return "等待结果";
  return "—";
}

/**
 * 邮件 + 日程 + 用户的手动修改 → 投递表。
 *
 * @param emails 逐封邮件（不是合并后的事）。轮次和结果要看每一封自己的原文
 * @param agenda 已经叠加过用户决定的日程，用来找每家公司的「下一步」
 * @param nowMs  现在。已经过去的安排不算下一步
 *
 * 只认邮件、你手动加的和你的修改——台账不再参与（作者 10/13 定）。
 */
export function buildApplications(
  emails: readonly ApplicationEmail[],
  agenda: readonly AgendaItem[],
  edits: UserEdits,
  nowMs: number,
): ApplicationRow[] {
  const rows = new Map<string, ApplicationRow>();

  const ordered = [...emails].sort((a, b) => Date.parse(a.receivedAtUtc) - Date.parse(b.receivedAtUtc));
  for (const email of ordered) {
    // 被忽略的、连公司都认不出的，不构成一条投递记录
    if (email.place === "ignored" || email.result.destination === "dropped") continue;
    const key = companyKey(email.result);
    if (key.length === 0) continue;

    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        company: email.result.displayCompany.length > 0 ? email.result.displayCompany : email.result.company,
        role: null,
        location: null,
        stage: "applied",
        round: null,
        manualStage: false,
        resultUnclear: false,
        reach: "applied",
        next: null,
        firstSeenUtc: email.receivedAtUtc,
        lastSeenUtc: email.receivedAtUtc,
        emailIds: [],
        pendingCount: 0,
        followUpDue: false,
        note: null,
        edited: false,
        origin: "email",
      };
      rows.set(key, row);
    }
    row.emailIds = [...row.emailIds, email.sampleId];
    row.lastSeenUtc = email.receivedAtUtc;
    if (row.role === null && email.result.role !== null) row.role = email.result.role;
    const location = email.result.extraction?.locationRaw ?? null;
    if (row.location === null && location !== null) row.location = location;

    // 还在等用户确认的事不拿来推状态——系统自己都拿不准，不能据此改一家公司的进度
    if (email.place === "pending") {
      row.pendingCount += 1;
      continue;
    }
    const evidence = evidenceOf(email);
    if (evidence === null) continue;
    if (evidence.unclearResult) row.resultUnclear = true;
    if (STAGE_RANK[evidence.stage] > STAGE_RANK[row.stage]) {
      row.stage = evidence.stage;
      row.round = evidence.round;
    } else if (evidence.stage === "interview" && row.stage === "interview" && evidence.round !== null) {
      // 同在面试阶段：轮次只往后走
      if (row.round === null || ROUND_RANK[evidence.round] > ROUND_RANK[row.round]) row.round = evidence.round;
    }
    row.reach = reachOf(evidence.stage, row.reach);
  }

  for (const manual of edits.manualApplications) {
    const firstSeenUtc = /^\d{4}-\d{2}-\d{2}$/.test(manual.appliedOn) ? `${manual.appliedOn}T12:00:00.000Z` : null;
    rows.set(`manual:${manual.id}`, {
      key: `manual:${manual.id}`,
      company: manual.company,
      role: manual.role.length > 0 ? manual.role : null,
      location: null,
      stage: manual.stage,
      round: manual.stage === "interview" ? manual.round : null,
      manualStage: true,
      resultUnclear: false,
      reach: reachOf(manual.stage, "applied"),
      next: null,
      firstSeenUtc,
      lastSeenUtc: firstSeenUtc,
      emailIds: [],
      pendingCount: 0,
      followUpDue: false,
      note: null,
      edited: false,
      origin: "manual",
    });
  }

  for (const [key, patch] of Object.entries(edits.applicationPatches)) {
    const row = rows.get(key);
    if (row) applyPatch(row, patch);
  }

  // 下一步：这家公司在日程上最近的一件还没过去的事；没有带时刻的，就取一件没写时间的
  for (const row of rows.values()) {
    if (row.origin !== "email") continue;
    const mine = agenda.filter(
      (item) => item.place === "board" && item.completion === null && companyKey(item.result) === row.key,
    );
    const timed = mine
      .filter((item) => item.result.when !== null && Date.parse(item.result.when.utc) > nowMs)
      .sort((a, b) => Date.parse(a.result.when?.utc ?? "") - Date.parse(b.result.when?.utc ?? ""));
    const pick = timed[0] ?? mine.find((item) => item.result.when === null);
    if (pick && (pick.result.eventType === "assessment" || pick.result.eventType === "interview" || pick.result.eventType === "update")) {
      row.next = {
        label: pick.result.kindLabel,
        utc: pick.result.when?.utc ?? null,
        isDeadline: pick.result.dueType === "deadline",
      };
    }
  }

  markWaitingForResult(rows, agenda, nowMs);

  // 你在「编辑」里改的最后叠上去：比邮件推断、「等结果」都优先
  const today = new Date(nowMs).toISOString().slice(0, 10);
  for (const [key, edit] of Object.entries(edits.rowEdits)) {
    const row = rows.get(key);
    if (!row) continue;
    if (edit.company !== undefined && edit.company.trim().length > 0) row.company = edit.company;
    if (edit.role !== undefined) row.role = edit.role.trim().length > 0 ? edit.role : null;
    if (edit.location !== undefined) row.location = edit.location.trim().length > 0 ? edit.location : null;
    if (edit.next !== undefined || edit.followUp !== undefined) {
      const label = edit.next ?? row.next?.label ?? "";
      const followUp = edit.followUp ?? row.next?.dateOnly ?? "";
      if (label.trim().length === 0 && followUp.length === 0) {
        row.next = null;
        row.followUpDue = false;
      } else {
        row.next = {
          label: label.trim().length > 0 ? label : "跟进",
          utc: null,
          isDeadline: false,
          ...(followUp.length > 0 ? { dateOnly: followUp } : {}),
        };
        row.followUpDue = followUp.length > 0 && followUp <= today;
      }
    }
    if (edit.note !== undefined) row.note = edit.note.trim().length > 0 ? edit.note : null;
    row.edited = (Object.keys(edit) as (keyof typeof edit)[]).some((field) => field !== "note");
  }

  // 最近有动静的排前面
  return [...rows.values()].sort(
    (a, b) => Date.parse(b.lastSeenUtc ?? "1970-01-01") - Date.parse(a.lastSeenUtc ?? "1970-01-01"),
  );
}

/** 公司名够不够得上「同一家」：完全相同，或一个包含另一个（「星河」⊂「星河科技 (xinghe tech)」），且短的那个至少两个字。 */
function sameCompany(a: string, b: string): boolean {
  if (a === b) return a.length > 0;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && long.includes(short);
}

/** 测评或面试做完之后，默认过几天该跟进一次结果。 */
export const FOLLOW_UP_DAYS = 7;

/**
 * 你在日程上标了「完成」的测评 / 面试 → 这家公司的下一步变成「等结果」，并给一个跟进日期。
 * 只在这家公司没有更晚的、还没做的安排时才这样写——还有下一场就先显示下一场。
 */
function markWaitingForResult(rows: Map<string, ApplicationRow>, agenda: readonly AgendaItem[], nowMs: number): void {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const done = agenda.filter(
    (item) =>
      item.completion?.state === "done" &&
      (item.result.eventType === "assessment" || item.result.eventType === "interview"),
  );
  if (done.length === 0) return;
  for (const row of rows.values()) {
    if (row.origin === "manual" || row.stage === "rejected" || row.stage === "offer") continue;
    const mine = done.filter((item) => companyKey(item.result) === row.key || sameCompany(companyKey(item.result), row.key));
    if (mine.length === 0) continue;
    const doneAt = (item: AgendaItem) => (item.result.when ? Date.parse(item.result.when.utc) : (item.completion?.atMs ?? nowMs));
    const latest = mine.reduce((a, b) => (doneAt(b) > doneAt(a) ? b : a));
    const latestAt = doneAt(latest);
    const upcoming = row.next !== null && row.next.utc !== null && Date.parse(row.next.utc) > latestAt && Date.parse(row.next.utc) > nowMs;
    if (upcoming) continue;
    const day = new Date(latestAt).toISOString().slice(0, 10);
    const followUp = new Date(Date.parse(`${day}T00:00:00Z`) + FOLLOW_UP_DAYS * 86_400_000).toISOString().slice(0, 10);
    row.next = {
      label: `等${latest.result.kindLabel}结果（${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日已完成）`,
      utc: null,
      isDeadline: false,
      dateOnly: followUp,
    };
    row.followUpDue = followUp <= today;
  }
}

function applyPatch(row: ApplicationRow, patch: ApplicationPatch): void {
  row.stage = patch.stage;
  row.round = patch.stage === "interview" ? patch.round : null;
  row.manualStage = true;
  row.resultUnclear = false;
  row.reach = reachOf(patch.stage, row.reach);
}
