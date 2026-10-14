import type { AgendaItem } from "./agenda";
import type { ApplicationRow } from "./applications";
import type { DemoResult } from "./parseDemo";
import type { SampleEmail } from "./sampleEmails";

/**
 * 搜索：公司、岗位、事件、邮件主题和发件人、你的备注里出现这串字就算命中。不分大小写，空格隔开的几个词都要命中。
 * 只做「过滤」，结果仍用各自的视图展示（日程卡、投递表、邮件列表），不另做一套。
 */
function terms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0);
}

function hits(haystack: readonly (string | null | undefined)[], query: string): boolean {
  const text = haystack.filter((v): v is string => typeof v === "string").join(" ").toLowerCase();
  return terms(query).every((t) => text.includes(t));
}

export function matchItem(item: AgendaItem, query: string): boolean {
  const r = item.result;
  return hits([r.displayCompany, r.company, r.role, r.kindLabel, item.note, ...item.sources.map((s) => s.subject)], query);
}

export function matchRow(row: ApplicationRow, query: string): boolean {
  return hits([row.company, row.role, row.location, row.next?.label, row.note], query);
}

export function matchEmail(sample: SampleEmail, result: DemoResult | undefined, query: string): boolean {
  return hits([sample.raw.subject, sample.raw.from, result?.displayCompany, result?.role], query);
}

export function isSearching(query: string): boolean {
  return terms(query).length > 0;
}
