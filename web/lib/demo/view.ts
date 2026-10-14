import { applyEdits, buildAgenda } from "./agenda";
import type { AgendaItem } from "./agenda";
import { buildApplications } from "./applications";
import type { ApplicationRow } from "./applications";
import { notParsedResult } from "./parseDemo";
import type { DemoResult } from "./parseDemo";
import type { SampleEmail } from "./sampleEmails";
import { senderAddress } from "./userEdits";
import type { UserEdits } from "./userEdits";

/**
 * 看板的全部视图数据，从「邮件 + 结论 + 你的修改」一次算出来（台账不参与，作者 10/13 定）。
 *
 * 看板页面和收信程序里的日历订阅（/cal/…ics）用的是**同一个函数**——
 * 日历上看到的和看板上看到的必须是同一份东西，不能各算各的。
 */
export interface BoardData {
  /** 没删的邮件。 */
  samples: SampleEmail[];
  /** 回收站里的邮件，最近删的在前。 */
  trashed: SampleEmail[];
  /** 每封邮件的结论（已叠上改名、屏蔽）。回收站里的也在，供恢复前查看。 */
  results: ReadonlyMap<string, DemoResult>;
  agenda: AgendaItem[];
  applications: ApplicationRow[];
}

/**
 * 你记住的改名、你屏蔽的发件人叠到结论上。
 * 改名只改显示（合并、时区记忆仍按系统认出的名字）；屏蔽的一律按「已忽略」。
 */
export function effectiveResults(
  rawResults: ReadonlyMap<string, DemoResult>,
  samples: readonly SampleEmail[],
  edits: UserEdits,
): ReadonlyMap<string, DemoResult> {
  const names = edits.companyNames;
  const blocked = new Set(edits.blockedSenders);
  if (Object.keys(names).length === 0 && blocked.size === 0) return rawResults;
  const fromOf = new Map(samples.map((s) => [s.id, senderAddress(s.raw.from)]));
  const out = new Map<string, DemoResult>();
  for (const [id, result] of rawResults) {
    const address = fromOf.get(id) ?? "";
    if (address.length > 0 && blocked.has(address)) {
      out.set(id, notParsedResult("你屏蔽的发件人", `你把 ${address} 标成了广告：这个发件人的信不再显示，收信程序也不再为它调用模型。`));
      continue;
    }
    const renamed = names[result.company];
    out.set(id, renamed === undefined ? result : { ...result, displayCompany: renamed });
  }
  return out;
}

/** 只算到日程为止（日历订阅用：不需要投递表，少算一半）。 */
export function buildAgendaData(
  allSamples: readonly SampleEmail[],
  rawResults: ReadonlyMap<string, DemoResult>,
  edits: UserEdits,
  viewerTimeZone: string,
): Pick<BoardData, "samples" | "trashed" | "results" | "agenda"> {
  const results = effectiveResults(rawResults, allSamples, edits);
  // 删掉的邮件不参与任何推断：从它来的日程、待确认、投递都跟着消失
  const samples = allSamples.filter((s) => edits.deletedEmails[s.id] === undefined);
  const trashed = allSamples
    .filter((s) => edits.deletedEmails[s.id] !== undefined)
    .sort((a, b) => (edits.deletedEmails[b.id] ?? 0) - (edits.deletedEmails[a.id] ?? 0));
  const agenda = applyEdits(
    buildAgenda(
      samples.flatMap((sample) => {
        const result = results.get(sample.id);
        return result ? [{ sampleId: sample.id, subject: sample.raw.subject, result }] : [];
      }),
    ),
    edits,
    viewerTimeZone,
  );
  return { samples, trashed, results, agenda };
}

export function buildBoardData(
  allSamples: readonly SampleEmail[],
  rawResults: ReadonlyMap<string, DemoResult>,
  edits: UserEdits,
  nowMs: number,
  viewerTimeZone: string,
): BoardData {
  const { samples, trashed, results, agenda } = buildAgendaData(allSamples, rawResults, edits, viewerTimeZone);
  const placeOf = new Map<string, AgendaItem["place"]>();
  for (const item of agenda) for (const source of item.sources) placeOf.set(source.sampleId, item.place);
  const emails = samples.flatMap((sample) => {
    const result = results.get(sample.id);
    if (!result) return [];
    return [
      {
        sampleId: sample.id,
        subject: sample.raw.subject,
        body: sample.raw.body,
        receivedAtUtc: sample.raw.receivedAtUtc,
        result,
        place: placeOf.get(sample.id) ?? ("ignored" as const),
      },
    ];
  });
  const applications = buildApplications(emails, agenda, edits, nowMs);
  return { samples, trashed, results, agenda, applications };
}
