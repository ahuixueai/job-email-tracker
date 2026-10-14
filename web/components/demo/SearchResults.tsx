"use client";

import { CardGrid, PendingView } from "@/components/demo/AgendaView";
import type { AgendaActions } from "@/components/demo/AgendaView";
import { ApplicationsView } from "@/components/demo/ApplicationsView";
import type { ApplicationActions } from "@/components/demo/ApplicationsView";
import { EmailView } from "@/components/demo/EmailView";
import type { EmailActions } from "@/components/demo/EmailView";
import type { AgendaItem } from "@/lib/demo/agenda";
import type { ApplicationRow } from "@/lib/demo/applications";
import type { DemoResult } from "@/lib/demo/parseDemo";
import type { SampleEmail } from "@/lib/demo/sampleEmails";
import { matchEmail, matchItem, matchRow } from "@/lib/demo/search";

/**
 * 搜索结果：按「日程 / 待确认 / 投递 / 邮件」分组，每组直接用原来的视图组件展示，
 * 卡片和表格上的操作（完成、编辑、确认、这是广告、删除…）都和平时一样能用。
 */
export function SearchResults({
  query,
  agenda,
  applications,
  samples,
  trashed,
  results,
  viewerTimeZone,
  agendaActions,
  applicationActions,
  emailActions,
  onEmailDetail,
}: {
  query: string;
  agenda: readonly AgendaItem[];
  applications: readonly ApplicationRow[];
  samples: readonly SampleEmail[];
  trashed: readonly SampleEmail[];
  results: ReadonlyMap<string, DemoResult>;
  viewerTimeZone: string;
  agendaActions: AgendaActions;
  applicationActions: ApplicationActions;
  emailActions: EmailActions;
  onEmailDetail: (sampleId: string) => void;
}) {
  const items = agenda.filter((item) => matchItem(item, query));
  const board = items.filter((item) => item.place === "board");
  const pending = items.filter((item) => item.place === "pending");
  const rows = applications.filter((row) => matchRow(row, query));
  const emails = samples.filter((s) => matchEmail(s, results.get(s.id), query));
  const trash = trashed.filter((s) => matchEmail(s, results.get(s.id), query));
  const total = board.length + pending.length + rows.length + emails.length + trash.length;

  return (
    <div className="space-y-8" data-search-results>
      {total === 0 ? <p className="text-sm text-ink-faint">没有找到「{query.trim()}」。</p> : null}
      {board.length > 0 ? (
        <Group title="日程" count={board.length}>
          <CardGrid items={board} viewerTimeZone={viewerTimeZone} actions={agendaActions} />
        </Group>
      ) : null}
      {pending.length > 0 ? (
        <Group title="待确认" count={pending.length}>
          <PendingView items={pending} viewerTimeZone={viewerTimeZone} actions={agendaActions} />
        </Group>
      ) : null}
      {rows.length > 0 ? (
        <Group title="投递" count={rows.length}>
          <ApplicationsView rows={rows} viewerTimeZone={viewerTimeZone} actions={applicationActions} />
        </Group>
      ) : null}
      {emails.length + trash.length > 0 ? (
        <Group title="邮件" count={emails.length + trash.length}>
          <EmailView samples={emails} trashed={trash} results={results} viewerTimeZone={viewerTimeZone} onDetail={onEmailDetail} actions={emailActions} />
        </Group>
      ) : null}
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} data-search-group={title}>
      <h2 className="mb-2 text-sm font-semibold text-ink">
        {title}
        <span className="tabular ml-2 text-xs font-normal text-ink-faint">{count}</span>
      </h2>
      {children}
    </section>
  );
}
