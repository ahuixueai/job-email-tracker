"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, CircleHelp, ListChecks, Mail, Table2 } from "lucide-react";
import { AgendaView, PendingView } from "@/components/demo/AgendaView";
import type { AgendaActions } from "@/components/demo/AgendaView";
import { ApplicationsView } from "@/components/demo/ApplicationsView";
import type { ApplicationActions } from "@/components/demo/ApplicationsView";
import { CalendarView } from "@/components/demo/CalendarView";
import { DetailPanel } from "@/components/demo/DetailPanel";
import type { DetailEmail } from "@/components/demo/DetailPanel";
import { EmailView } from "@/components/demo/EmailView";
import { EventForm } from "@/components/demo/EventForm";
import type { EventFormValue } from "@/components/demo/EventForm";
import { StatsView } from "@/components/demo/StatsView";
import { applyEdits, buildAgenda } from "@/lib/demo/agenda";
import type { AgendaItem } from "@/lib/demo/agenda";
import { buildApplications } from "@/lib/demo/applications";
import { runDemoParse } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";
import { hasRecording, parseRecording, RecordedExtractor } from "@/lib/demo/recorded";
import recordedJson from "@/lib/demo/recordedExtractions.json";
import { buildSampleEmails } from "@/lib/demo/sampleEmails";
import { funnel, handling, kpis, stageDistribution, upcomingLoad, weeklyEmails } from "@/lib/demo/stats";
import {
  addManualApplication,
  addManualEvent,
  decide,
  EDITS_STORAGE_KEY,
  EMPTY_EDITS,
  hasEdits,
  kindIdOf,
  parseEdits,
  patchApplication,
  removeManualApplication,
  removeManualEvent,
  undecide,
  unpatchApplication,
  utcToLocalInput,
} from "@/lib/demo/userEdits";
import type { TimeKind, UserEdits } from "@/lib/demo/userEdits";

const RECORDING = parseRecording(recordedJson);

type View = "agenda" | "calendar" | "pending" | "applications" | "stats" | "emails";

const VIEW_TITLE: Readonly<Record<View, string>> = {
  agenda: "日程",
  calendar: "日历",
  pending: "待确认",
  applications: "投递",
  stats: "统计",
  emails: "邮件",
};

/** 详情面板里要展示的东西：一条结论，加上它来自的那几封邮件。 */
interface Detail {
  result: DemoResult;
  sampleIds: readonly string[];
  userNote?: string;
}

/** 正在填的表单：新加一条日程，或确认一件待确认的事。 */
type FormState = { mode: "add"; dateKey?: string } | { mode: "confirm"; item: AgendaItem };

const subscribeNever = () => () => {};

/**
 * 样本里的日期相对「现在」生成，服务端与浏览器的「现在」不是同一刻，
 * 直接渲染必然 hydration mismatch。所以整块只在客户端挂载后才出现。
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/** 读浏览器里存的手动操作。隐私模式、存储被禁用时读不到，按「没有任何操作」处理。 */
function loadEdits(): UserEdits {
  try {
    const raw = window.localStorage.getItem(EDITS_STORAGE_KEY);
    return raw === null ? EMPTY_EDITS : parseEdits(JSON.parse(raw));
  } catch {
    return EMPTY_EDITS;
  }
}

function saveEdits(edits: UserEdits): void {
  try {
    if (hasEdits(edits)) window.localStorage.setItem(EDITS_STORAGE_KEY, JSON.stringify(edits));
    else window.localStorage.removeItem(EDITS_STORAGE_KEY);
  } catch {
    // 存不了就只在这次打开期间有效，页面照常能用
  }
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 主看板：侧边栏切换「日程 / 日历 / 待确认 / 投递 / 统计 / 邮件」六个视图。
 *
 * 数据目前是 lib/demo/sampleEmails.ts 的合成邮件，现场用解析引擎算出来；
 * 你在页面上做的手动操作（确认、移出、添加、改状态）只存在这台浏览器里。
 * 接真实台账是下一步，届时只换数据来源和存储位置，视图不动。
 */
export function Workspace() {
  const mounted = useMounted();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      {mounted ? <Loaded /> : <p className="pt-10 text-sm text-ink-faint">载入中…</p>}
    </div>
  );
}

function Loaded() {
  const [nowMs] = useState(() => Date.now());
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const samples = useMemo(() => buildSampleEmails(nowMs), [nowMs]);

  const [view, setView] = useState<View>("agenda");
  const [results, setResults] = useState<ReadonlyMap<string, DemoResult>>(new Map());
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [edits, setEdits] = useState<UserEdits>(loadEdits);

  const update = useCallback((change: (current: UserEdits) => UserEdits) => {
    setEdits((current) => {
      const next = change(current);
      saveEdits(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all(
      samples.map(async (sample) => {
        const result = await runDemoParse(sample.raw, {
          viewerTimeZone,
          ...(hasRecording(RECORDING, sample.id)
            ? { extractor: new RecordedExtractor(RECORDING, sample.tokens) }
            : {}),
        });
        return [sample.id, result] as const;
      }),
    ).then(
      (pairs) => {
        if (alive) setResults(new Map(pairs));
      },
      () => {
        // 引擎只在内部不变量被破坏时才抛异常。看板不该因此白屏。
        if (alive) setResults(new Map());
      },
    );
    return () => {
      alive = false;
    };
  }, [samples, viewerTimeZone]);

  // 解析结果每次现场重算，用户的决定单独存、最后叠上去
  const agenda = useMemo(
    () =>
      applyEdits(
        buildAgenda(
          samples.flatMap((sample) => {
            const result = results.get(sample.id);
            return result ? [{ sampleId: sample.id, subject: sample.raw.subject, result }] : [];
          }),
        ),
        edits,
        viewerTimeZone,
      ),
    [results, samples, edits, viewerTimeZone],
  );

  const applications = useMemo(() => {
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
    return buildApplications(emails, agenda, edits, nowMs);
  }, [agenda, samples, results, edits, nowMs]);

  const stats = useMemo(() => {
    const emails = samples.flatMap((sample) => {
      const result = results.get(sample.id);
      return result ? [{ receivedAtUtc: sample.raw.receivedAtUtc, destination: result.destination }] : [];
    });
    return {
      kpis: kpis(applications, agenda, nowMs),
      funnel: funnel(applications),
      stages: stageDistribution(applications),
      upcoming: upcomingLoad(agenda, nowMs, viewerTimeZone),
      weekly: weeklyEmails(emails, nowMs, viewerTimeZone),
      handling: handling(emails),
    };
  }, [applications, agenda, samples, results, nowMs, viewerTimeZone]);

  const boardCount = agenda.filter((item) => item.place === "board").length;
  const pendingCount = agenda.filter((item) => item.place === "pending").length;

  const openEmail = (sampleId: string) => {
    const result = results.get(sampleId);
    if (result) setDetail({ result, sampleIds: [sampleId] });
  };
  const closeDetail = useCallback(() => setDetail(null), []);
  const closeForm = useCallback(() => setForm(null), []);

  const agendaActions: AgendaActions = {
    onDetail: (item) =>
      setDetail({
        result: item.result,
        sampleIds: item.sources.map((s) => s.sampleId),
        ...(item.origin === "manual"
          ? { userNote: "这条日程是你手动添加的，不来自任何一封邮件。" }
          : item.decision?.action === "confirm"
            ? {
                userNote:
                  item.decision.kind !== null || item.decision.time !== null
                    ? "系统原本拿不准，是你确认后排进日程的；类型或时间按你填的显示。下面是系统当时的判断。"
                    : "系统原本拿不准，是你确认后排进日程的。下面是系统当时的判断。",
              }
            : {}),
      }),
    onConfirm: (item) => setForm({ mode: "confirm", item }),
    onTrack: (item) => update((e) => decide(e, item.id, { action: "track" })),
    onIgnore: (item) => update((e) => decide(e, item.id, { action: "ignore" })),
    onRemove: (item) =>
      update((e) =>
        item.origin === "manual"
          ? removeManualEvent(e, item.id.replace(/^manual:/, ""))
          : decide(e, item.id, { action: "remove" }),
      ),
    onUndo: (item) => update((e) => undecide(e, item.id)),
    onAdd: (dateKey) => setForm(dateKey ? { mode: "add", dateKey } : { mode: "add" }),
  };

  const applicationActions: ApplicationActions = {
    onDetail: (row) => {
      const latest = [...row.emailIds].reverse().find((id) => results.has(id));
      const result = latest ? results.get(latest) : undefined;
      if (result) setDetail({ result, sampleIds: row.emailIds });
    },
    onPatch: (row, patch) => update((e) => patchApplication(e, row.key, patch)),
    onUnpatch: (row) => update((e) => unpatchApplication(e, row.key)),
    onAdd: (application) =>
      update((e) => addManualApplication(e, { ...application, id: newId(), createdAtMs: Date.now() })),
    onRemove: (row) => update((e) => removeManualApplication(e, row.key.replace(/^manual:/, ""))),
  };

  const submitForm = (value: EventFormValue) => {
    if (form === null) return;
    if (form.mode === "add") {
      update((e) =>
        addManualEvent(e, {
          ...value.time,
          id: newId(),
          company: value.company,
          role: value.role,
          kind: value.kind,
          createdAtMs: Date.now(),
        }),
      );
    } else {
      const initial = confirmInitial(form.item, viewerTimeZone);
      const timeChanged =
        value.time.timeKind !== initial.timeKind ||
        (value.time.timeKind !== "none" && value.time.startUtc !== form.item.result.when?.utc);
      update((e) =>
        decide(e, form.item.id, {
          action: "confirm",
          // 没改的部分存 null：沿用系统的判断，引擎以后改进了这部分会跟着变好
          kind: value.kind === initial.kind ? null : value.kind,
          time: timeChanged ? value.time : null,
        }),
      );
    }
    setForm(null);
    if (view === "pending") setView("agenda");
  };

  const detailEmails: DetailEmail[] = (detail?.sampleIds ?? []).flatMap((id) => {
    const sample = samples.find((s) => s.id === id);
    return sample ? [{ sample, result: results.get(id) }] : [];
  });
  const detailUsesModel = (detail?.sampleIds ?? []).some((id) => hasRecording(RECORDING, id));
  const extractorNote = detailUsesModel
    ? `公司、岗位、时间片段由模型从原文摘出（${RECORDING.model}，预先录制）；是什么事、什么时候、哪个时区由规则判断。`
    : "这里只用了规则，没有模型参与。";

  const tabs: readonly { id: View; count: number | null; icon: React.ReactNode }[] = [
    { id: "agenda", count: boardCount, icon: <ListChecks size={15} aria-hidden /> },
    { id: "calendar", count: null, icon: <CalendarDays size={15} aria-hidden /> },
    { id: "pending", count: pendingCount, icon: <CircleHelp size={15} aria-hidden /> },
    { id: "applications", count: applications.length, icon: <Table2 size={15} aria-hidden /> },
    { id: "stats", count: null, icon: <BarChart3 size={15} aria-hidden /> },
    { id: "emails", count: samples.length, icon: <Mail size={15} aria-hidden /> },
  ];

  return (
    <div className="grid gap-x-8 gap-y-4 pt-8 md:grid-cols-[10rem_1fr]">
      <aside className="min-w-0">
        <p className="text-xs tracking-widest text-ink-faint">JOB COMMAND CENTER</p>
        <nav aria-label="视图" className="mt-4">
          <ul className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
            {tabs.map((tab) => (
              <li key={tab.id} className="shrink-0 md:shrink">
                <button
                  type="button"
                  onClick={() => setView(tab.id)}
                  aria-current={view === tab.id ? "page" : undefined}
                  data-view-tab={tab.id}
                  className={
                    view === tab.id
                      ? "flex w-full items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm font-medium text-on-brand-soft"
                      : "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-raised"
                  }
                >
                  {tab.icon}
                  {VIEW_TITLE[tab.id]}
                  {tab.count !== null ? (
                    <span className="tabular ml-auto pl-2 text-xs">{tab.count}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-4 hidden flex-col items-start gap-2 md:flex">
          {hasEdits(edits) ? (
            <button
              type="button"
              onClick={() => update(() => EMPTY_EDITS)}
              data-action="reset"
              className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink-soft"
            >
              撤销我的全部手动操作
            </button>
          ) : null}
          <Link href="/board" className="text-xs text-ink-faint underline underline-offset-2 hover:text-ink-soft">
            旧版看板
          </Link>
        </div>
      </aside>

      <section className="min-w-0" data-view={view}>
        <header className="pb-5">
          <h1 className="text-2xl font-semibold text-ink">{VIEW_TITLE[view]}</h1>
          <p className="mt-1 text-xs text-ink-faint">
            演示数据：以下公司与邮件均为虚构。你在页面上的手动操作只保存在这台浏览器里。
          </p>
        </header>

        {view === "agenda" ? (
          <AgendaView items={agenda} viewerTimeZone={viewerTimeZone} actions={agendaActions} />
        ) : null}
        {view === "calendar" ? (
          <CalendarView items={agenda} viewerTimeZone={viewerTimeZone} nowMs={nowMs} actions={agendaActions} />
        ) : null}
        {view === "pending" ? (
          <PendingView items={agenda} viewerTimeZone={viewerTimeZone} actions={agendaActions} />
        ) : null}
        {view === "applications" ? (
          <ApplicationsView rows={applications} viewerTimeZone={viewerTimeZone} actions={applicationActions} />
        ) : null}
        {view === "stats" ? <StatsView data={stats} /> : null}
        {view === "emails" ? (
          <EmailView
            samples={samples}
            results={results}
            viewerTimeZone={viewerTimeZone}
            onDetail={openEmail}
          />
        ) : null}
      </section>

      {detail ? (
        <DetailPanel
          result={detail.result}
          emails={detailEmails}
          viewerTimeZone={viewerTimeZone}
          extractorNote={extractorNote}
          {...(detail.userNote ? { userNote: detail.userNote } : {})}
          onClose={closeDetail}
        />
      ) : null}

      {form ? (
        <EventForm
          key={form.mode === "confirm" ? form.item.id : `add-${form.dateKey ?? ""}`}
          title={form.mode === "confirm" ? "放进日程" : "添加日程"}
          submitLabel={form.mode === "confirm" ? "确认，放进日程" : "添加"}
          lockIdentity={form.mode === "confirm"}
          initial={
            form.mode === "confirm"
              ? confirmInitial(form.item, viewerTimeZone)
              : {
                  company: "",
                  role: "",
                  kind: "video_interview",
                  timeKind: "fixed_start",
                  local: form.dateKey ? `${form.dateKey}T10:00` : "",
                }
          }
          viewerTimeZone={viewerTimeZone}
          onSubmit={submitForm}
          onCancel={closeForm}
        />
      ) : null}
    </div>
  );
}

/** 「放进日程」表单的预填值：系统已经读出来的部分照搬，读不出来的留空让用户填。 */
function confirmInitial(
  item: AgendaItem,
  viewerTimeZone: string,
): { company: string; role: string; kind: ReturnType<typeof kindIdOf>; timeKind: TimeKind; local: string } {
  const { result } = item;
  const hasMoment = result.when !== null && result.when.viewer !== null;
  const timeKind: TimeKind =
    result.dueType === "deadline" ? "deadline" : result.dueType === "unknown" ? "none" : "fixed_start";
  return {
    company: result.displayCompany.length > 0 ? result.displayCompany : "公司未认出",
    role: result.role ?? "",
    kind: kindIdOf(result.eventType, result.format),
    timeKind,
    local: hasMoment && result.when ? utcToLocalInput(result.when.utc, viewerTimeZone) : "",
  };
}
