"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, CircleHelp, House, ListChecks, Mail, Search, Settings, Table2, X } from "lucide-react";
import { AgendaView, PendingView } from "@/components/demo/AgendaView";
import type { AgendaActions } from "@/components/demo/AgendaView";
import { ApplicationsView } from "@/components/demo/ApplicationsView";
import type { ApplicationActions } from "@/components/demo/ApplicationsView";
import { CalendarView } from "@/components/demo/CalendarView";
import { DetailPanel } from "@/components/demo/DetailPanel";
import type { DetailEmail } from "@/components/demo/DetailPanel";
import { EmailView } from "@/components/demo/EmailView";
import type { EmailActions } from "@/components/demo/EmailView";
import { EventForm } from "@/components/demo/EventForm";
import type { EventFormValue } from "@/components/demo/EventForm";
import { StatsView } from "@/components/demo/StatsView";
import { buildBoardData } from "@/lib/demo/view";
import { SearchResults } from "@/components/demo/SearchResults";
import { SettingsView } from "@/components/demo/SettingsView";
import { isSearching } from "@/lib/demo/search";
import { TodayView } from "@/components/demo/TodayView";
import { dateKeyIn } from "@/lib/demo/agenda";
import type { AgendaItem } from "@/lib/demo/agenda";
import type { DemoResult } from "@/lib/demo/parseDemo";
import type { SampleEmail } from "@/lib/demo/sampleEmails";
import { funnel, handling, kpis, stageDistribution, upcomingLoad, weeklyEmails } from "@/lib/demo/stats";
import {
  addManualApplication,
  addManualEvent,
  blockSender,
  clearItemEdit,
  clearRow,
  complete,
  decide,
  editItem,
  replaceItemEdit,
  editRow,
  trashEmails,
  untrashEmails,
  forgetCompanyName,
  forgetCompanyZone,
  EMPTY_EDITS,
  kindIdOf,
  patchApplication,
  rememberCompanyName,
  rememberCompanyZone,
  senderAddress,
  unblockSender,
  removeManualApplication,
  removeManualEvent,
  uncomplete,
  undecide,
  utcToLocalInput,
} from "@/lib/demo/userEdits";
import { canPrepare, findPrepBlock, formatPrep, prepEdited, prepEmailsFor, prepHash, writePrep } from "@/lib/demo/prep";
import type { PrepOutput, PrepRequest } from "@/lib/demo/prep";
import type { QuickModelOutput } from "@/lib/demo/quickAdd";
import type { ItemEdit, TimeKind, UserEdits } from "@/lib/demo/userEdits";

type View = "today" | "agenda" | "calendar" | "pending" | "applications" | "stats" | "emails" | "settings";

const VIEW_TITLE: Readonly<Record<View, string>> = {
  today: "今天",
  agenda: "日程",
  calendar: "日历",
  pending: "待确认",
  applications: "投递",
  stats: "统计",
  emails: "邮件",
  settings: "设置",
};

/** 详情面板里要展示的东西：一条结论，加上它来自的那几封邮件。 */
interface Detail {
  result: DemoResult;
  sampleIds: readonly string[];
  userNote?: string;
  /** 日程上的一件事（能编辑）；单封邮件、投递表行没有。 */
  item?: AgendaItem;
  /** 从「邮件」里点开的单封信：可以删除 / 恢复。 */
  fromEmail?: boolean;
}

/** 正在填的表单：新加一条日程，或确认一件待确认的事。 */
type FormState =
  | { mode: "add"; dateKey?: string }
  | { mode: "confirm"; item: AgendaItem }
  | { mode: "edit"; item: AgendaItem };

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export interface BoardProps {
  /** 逐封邮件。演示站是合成样本，私人看板是收信程序存下的真实邮件。 */
  samples: readonly SampleEmail[];
  /** 每封邮件的解析结论，键是邮件 id。 */
  results: ReadonlyMap<string, DemoResult>;
  /** 你的手动操作。存在哪里由外面决定（浏览器本地 / 云端）。 */
  edits: UserEdits;
  onEditsChange: (change: (current: UserEdits) => UserEdits) => void;
  nowMs: number;
  viewerTimeZone: string;
  /** 标题下面那一行小字。 */
  notice: string;
  /** 详情里「模型和规则各管什么」那句说明。 */
  extractorNoteFor: (sampleIds: readonly string[]) => string;
  /** 侧边栏底部额外的链接。 */
  sidebarFooter?: React.ReactNode;
  /** 标题上方的提醒条（例如 Gmail 转发验证码）。 */
  banner?: React.ReactNode;
  /** 显示「这是广告」（屏蔽发件人）。私人看板打开，演示站不需要。 */
  blockable?: boolean;
  /** 彻底删除邮件（连原文从云端删掉）。只有私人看板有；演示站的回收站只能恢复。 */
  onPurgeEmails?: (sampleIds: readonly string[]) => Promise<void>;
  /** 「设置」页最上面的私人看板专属部分（日历订阅、数据状态、退出登录）。 */
  settingsExtra?: React.ReactNode;
  /** 收信可能出问题时的一句提醒（显示在「今天」）。 */
  healthWarning?: string | null;
  /** 「邮件」页顶上的教程（怎么把邮件发进来）。只有私人看板有。 */
  emailGuide?: React.ReactNode;
  /** 一句话添加用的 AI 识别。只有私人看板有。 */
  quickParse?: (text: string) => Promise<{ model: QuickModelOutput; warning: string | null }>;
  /** AI 面试准备。只有私人看板有。 */
  prepare?: (request: PrepRequest) => Promise<{ prep: PrepOutput; usedResume: boolean }>;
}

/**
 * 主看板：侧边栏切换「日程 / 日历 / 待确认 / 投递 / 统计 / 邮件」六个视图。
 *
 * 只管展示和交互，不管数据从哪来：演示站（Workspace）喂合成样本，私人看板喂收信程序存下的真实邮件。
 * 解析结果每次现场重算视图，用户的决定单独存、最后叠上去。
 */
export function Board({
  samples: allSamples,
  results: rawResults,
  edits,
  onEditsChange: commit,
  nowMs,
  viewerTimeZone,
  notice,
  extractorNoteFor,
  sidebarFooter,
  banner,
  blockable = false,
  onPurgeEmails,
  settingsExtra,
  healthWarning = null,
  emailGuide,
  quickParse,
  prepare,
}: BoardProps) {
  const data = useMemo(
    () => buildBoardData(allSamples, rawResults, edits, nowMs, viewerTimeZone),
    [allSamples, rawResults, edits, nowMs, viewerTimeZone],
  );
  const { samples, results, agenda, applications } = data;

  /**
   * 你的每一步操作都经过这里：存下操作前的样子（最多 20 步），底部提示「已…· 撤销」，Cmd/Ctrl+Z 也能撤。
   * 撤销记录只在这次打开页面期间有效，刷新后清空。
   * 彻底删除不经过这里——那一步删的是云端的原件，撤不回来，所以先要你确认。
   */
  /** 每一步怎么撤：一般是「回到操作前的样子」；等 AI 的那种只撤它自己改的那件事（见 generatePrep）。 */
  const [undoStack, setUndoStack] = useState<readonly { label: string; revert: (current: UserEdits) => UserEdits }[]>([]);
  const [toast, setToast] = useState<{ text: string; canUndo: boolean; key: number } | null>(null);
  const act = useCallback(
    (label: string, change: (current: UserEdits) => UserEdits) => {
      const before = edits;
      commit(change);
      setUndoStack((stack) => [...stack.slice(-19), { label, revert: () => before }]);
      setToast({ text: label, canUndo: true, key: Date.now() });
    },
    [edits, commit],
  );
  const undo = useCallback(() => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    commit(last.revert);
    setUndoStack((stack) => stack.slice(0, -1));
    setToast({ text: `已撤销：${last.label}`, canUndo: false, key: Date.now() });
  }, [undoStack, commit]);

  // 提示 6 秒后自己消失
  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const senderOfSample = (sampleId: string) => senderAddress(allSamples.find((s) => s.id === sampleId)?.raw.from ?? "");
  const [view, setView] = useState<View>("today");
  /** 从「今天」点「该跟进了」跳到投递表时，带上筛选。 */
  const [appFilter, setAppFilter] = useState<"followup" | null>(null);
  /** 搜索词。有字时内容区换成搜索结果；切换视图时清空。 */
  const [query, setQuery] = useState("");
  const searching = isSearching(query);
  const [detail, setDetail] = useState<Detail | null>(null);
  /** 正在为哪件事生成 AI 面试准备。 */
  const [prepState, setPrepState] = useState<{ itemId: string; busy: boolean; error: string | null } | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  // Cmd/Ctrl+Z 撤销上一步。正在打字（输入框、表单）时不拦截，那是撤销输入框里的字
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (form !== null || (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))) return;
      if (undoStack.length === 0) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [form, undoStack, undo]);
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

  const boardCount = agenda.filter((item) => item.place === "board" && item.completion === null).length;
  const pendingCount = agenda.filter((item) => item.place === "pending").length;

  const openEmail = (sampleId: string) => {
    const result = results.get(sampleId);
    if (!result) return;
    // 这封信属于日程上的某件事：详情里也给「编辑」，改的是那件事
    const item = agenda.find((a) => a.sources.some((source) => source.sampleId === sampleId));
    setDetail(item ? { result, sampleIds: [sampleId], item, fromEmail: true } : { result, sampleIds: [sampleId], fromEmail: true });
  };
  const closeDetail = useCallback(() => setDetail(null), []);
  const closeForm = useCallback(() => setForm(null), []);

  const agendaActions: AgendaActions = {
    onDetail: (item) =>
      setDetail({
        item,
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
    onTrack: (item) => act("只记到投递表", (e) => decide(e, item.id, { action: "track" })),
    onIgnore: (items) => act(items.length === 1 ? "已忽略" : `已忽略 ${items.length} 件`, (e) =>
        items.reduce((acc, item) => decide(acc, item.id, { action: "ignore" }), e),
      ),
    onRemove: (item) =>
      act(item.origin === "manual" ? "已删除这条日程" : "已移出日程", (e) =>
        item.origin === "manual"
          ? removeManualEvent(e, item.id.replace(/^manual:/, ""))
          : decide(e, item.id, { action: "remove" }),
      ),
    onUndo: (item) => act("已恢复到系统原来的位置", (e) => undecide(e, item.id)),
    onAdd: (dateKey) => setForm(dateKey ? { mode: "add", dateKey } : { mode: "add" }),
    onComplete: (item, state) => act(state === "done" ? "已标为完成" : "已标为没参加", (e) => complete(e, item.id, state, Date.now())),
    onUncomplete: (item) => act("已撤销完成", (e) => uncomplete(e, item.id)),
    onEdit: (item) => {
      setDetail(null);
      setForm({ mode: "edit", item });
    },
    ...(blockable
      ? {
          onBlock: (items: readonly AgendaItem[]) => blockSenders(items.flatMap((item) => item.sources.map((source) => source.sampleId))),
        }
      : {}),
  };

  const applicationActions: ApplicationActions = {
    onDetail: (row) => {
      const latest = [...row.emailIds].reverse().find((id) => results.has(id));
      const result = latest ? results.get(latest) : undefined;
      if (result) setDetail({ result, sampleIds: row.emailIds });
    },
    onEdit: (row, patch, change) =>
      act("已保存修改", (e) => {
        const patched = patch === null ? e : patchApplication(e, row.key, patch);
        return Object.keys(change).length === 0 ? patched : editRow(patched, row.key, change);
      }),
    onFollowUp: (rows, mode) => {
      // 「7 天后」按你这里的日历日算
      const today = dateKeyIn(nowMs, viewerTimeZone);
      const later = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
      act(
        mode === "later" ? `${rows.length} 条已跟进，${Number(later.slice(5, 7))}月${Number(later.slice(8, 10))}日再看` : `${rows.length} 条不用再跟进`,
        (e) => rows.reduce((acc, row) => editRow(acc, row.key, { followUp: mode === "later" ? later : "" }), e),
      );
    },
    onRestore: (row) => act("已恢复成系统推断的", (e) => clearRow(e, row.key)),
    onAdd: (application) =>
      act("已添加投递", (e) => addManualApplication(e, { ...application, id: newId(), createdAtMs: Date.now() })),
    onRemove: (row) => act("已删除这条投递", (e) => removeManualApplication(e, row.key.replace(/^manual:/, ""))),
  };

  const blockSenders = (sampleIds: readonly string[]) => {
    const addresses = [...new Set(sampleIds.map(senderOfSample).filter((a) => a.length > 0))];
    if (addresses.length === 0) return;
    act(addresses.length === 1 ? `已把 ${addresses[0]} 标成广告` : `已把 ${addresses.length} 个发件人标成广告`, (e) =>
      addresses.reduce((acc, address) => blockSender(acc, address), e),
    );
  };

  const emailActions: EmailActions = {
    ...(blockable ? { onBlock: blockSenders } : {}),
    onDelete: (ids) => act(`已删除 ${ids.length} 封邮件（在「邮件 → 回收站」里）`, (e) => trashEmails(e, ids, Date.now())),
    onRestore: (ids) => act(`已恢复 ${ids.length} 封邮件`, (e) => untrashEmails(e, ids)),
    ...(onPurgeEmails
      ? {
          onPurge: (ids: readonly string[]) => {
            // 彻底删除撤不回来，所以不进撤销记录；云端删成功了才把回收站里的记录清掉
            onPurgeEmails(ids).then(
              () => {
                commit((e) => untrashEmails(e, ids));
                setToast({ text: `已彻底删除 ${ids.length} 封邮件`, canUndo: false, key: Date.now() });
              },
              (error: unknown) =>
                setToast({ text: `彻底删除失败：${error instanceof Error ? error.message : String(error)}`, canUndo: false, key: Date.now() }),
            );
          },
        }
      : {}),
  };

  const submitForm = (value: EventFormValue) => {
    if (form === null) return;
    if (form.mode === "edit") {
      const { item } = form;
      const initial = editInitial(item, viewerTimeZone);
      // 只存改了的字段：没动的继续跟着系统走
      const change: ItemEdit = {};
      if (value.company !== initial.company) change.company = value.company;
      if (value.role !== initial.role) change.role = value.role;
      if (value.kind !== initial.kind) change.kind = value.kind;
      const timeChanged =
        value.time.timeKind !== initial.timeKind ||
        (value.time.timeKind !== "none" &&
          (value.time.startUtc !== (item.result.when?.utc ?? null) || value.time.timeZone !== initial.timeZone));
      if (timeChanged) change.time = value.time;
      if (value.note !== initial.note) change.note = value.note;
      act("已保存修改", (e) => {
        let next = Object.keys(change).length > 0 ? editItem(e, item.id, change) : e;
        if (value.rememberZone) next = rememberCompanyZone(next, item.result.company, value.time.timeZone);
        if (value.rememberName) next = rememberCompanyName(next, item.result.company, value.company);
        return next;
      });
      setForm(null);
      return;
    }
    if (form.mode === "add") {
      act("已添加日程", (e) =>
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
      const company = form.item.result.company;
      act("已放进日程", (e) => {
        const decided = decide(e, form.item.id, {
          action: "confirm",
          // 没改的部分存 null：沿用系统的判断，引擎以后改进了这部分会跟着变好
          kind: value.kind === initial.kind ? null : value.kind,
          time: timeChanged ? value.time : null,
        });
        return value.rememberZone ? rememberCompanyZone(decided, company, value.time.timeZone) : decided;
      });
    }
    setForm(null);
    if (view === "pending") setView("agenda");
  };

  const detailEmails: DetailEmail[] = (detail?.sampleIds ?? []).flatMap((id) => {
    const sample = allSamples.find((s) => s.id === id);
    return sample ? [{ sample, result: results.get(id) }] : [];
  });
  const extractorNote = extractorNoteFor(detail?.sampleIds ?? []);

  const tabs: readonly { id: View; count: number | null; icon: React.ReactNode }[] = [
    { id: "today", count: null, icon: <House size={15} aria-hidden /> },
    { id: "agenda", count: boardCount, icon: <ListChecks size={15} aria-hidden /> },
    { id: "calendar", count: null, icon: <CalendarDays size={15} aria-hidden /> },
    { id: "pending", count: pendingCount, icon: <CircleHelp size={15} aria-hidden /> },
    { id: "applications", count: applications.length, icon: <Table2 size={15} aria-hidden /> },
    { id: "stats", count: null, icon: <BarChart3 size={15} aria-hidden /> },
    { id: "emails", count: samples.length, icon: <Mail size={15} aria-hidden /> },
    { id: "settings", count: null, icon: <Settings size={15} aria-hidden /> },
  ];

  // 详情里的事用最新算出来的那份：生成准备、编辑之后备注和字段会变，面板要跟着变
  const liveDetailItem = detail?.item ? (agenda.find((i) => i.id === detail.item?.id) ?? detail.item) : undefined;

  /** AI 面试准备：收集这家公司的来信 → 交给 AI → 排成文字写进备注（一步，可撤销）。 */
  const generatePrep = useCallback(async (item: AgendaItem) => {
    if (!prepare) return;
    setPrepState({ itemId: item.id, busy: true, error: null });
    const request: PrepRequest = {
      company: item.result.displayCompany || item.result.company || "公司未认出",
      role: item.result.role,
      kind: item.result.kindLabel,
      when: item.result.when ? `${item.result.when.source ?? item.result.when.viewer}` : null,
      emails: prepEmailsFor(item, samples, results),
    };
    try {
      const { prep, usedResume } = await prepare(request);
      const day = new Date(nowMs).toLocaleDateString("zh-CN", { timeZone: viewerTimeZone, month: "numeric", day: "numeric" });
      const block = formatPrep(prep, day, usedResume, request.emails.length);
      // 等 AI 的半分钟里你可能又做了别的操作：所以撤销时只把这件事的修改换回写入前那份，不动别的
      let prior: ItemEdit | undefined;
      commit((e) => {
        prior = e.itemEdits[item.id];
        return editItem(e, item.id, { note: writePrep(prior?.note ?? null, block), aiPrep: prepHash(block) });
      });
      const label = "已写进备注：AI 面试准备";
      setUndoStack((stack) => [...stack.slice(-19), { label, revert: (current) => replaceItemEdit(current, item.id, prior) }]);
      setToast({ text: label, canUndo: true, key: Date.now() });
      setPrepState(null);
    } catch (error) {
      setPrepState({ itemId: item.id, busy: false, error: error instanceof Error ? error.message : "生成失败，稍后再试" });
    }
  }, [prepare, samples, results, nowMs, viewerTimeZone, commit]);

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
                  onClick={() => {
                    setAppFilter(null);
                    setQuery("");
                    setView(tab.id);
                  }}
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
        {/* 手机上侧边栏变成顶部一排，底部这些（刷新、退出等）放在那一排下面，不能藏起来 */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 md:mt-4 md:flex-col md:items-start" data-sidebar-footer>
          {sidebarFooter}
        </div>
      </aside>

      {/* 底部留白：撤销提示浮在最下面，滚到底也不挡住最后一行 */}
      <section className="min-w-0 pb-20" data-view={view}>
        {banner}
        <header className="pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold text-ink">{searching ? "搜索" : VIEW_TITLE[view]}</h1>
            <label className="relative w-full sm:w-72">
              <span className="sr-only">搜索</span>
              <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
                placeholder="搜公司、岗位、邮件主题、备注…"
                data-search-input
                className="w-full rounded-lg border border-hairline bg-surface py-1.5 pr-8 pl-8 text-sm text-ink placeholder:text-ink-faint"
              />
              {query.length > 0 ? (
                <button type="button" onClick={() => setQuery("")} aria-label="清空搜索" className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-ink-faint hover:text-ink">
                  <X size={14} aria-hidden />
                </button>
              ) : null}
            </label>
          </div>
          <p className="mt-1 text-xs text-ink-faint">{notice}</p>
        </header>

        {searching ? (
          <SearchResults
            query={query}
            agenda={agenda}
            applications={applications}
            samples={samples}
            trashed={data.trashed}
            results={results}
            viewerTimeZone={viewerTimeZone}
            agendaActions={agendaActions}
            applicationActions={applicationActions}
            emailActions={emailActions}
            onEmailDetail={openEmail}
          />
        ) : null}

        {!searching && view === "today" ? (
          <TodayView
            items={agenda}
            applications={applications}
            nowMs={nowMs}
            viewerTimeZone={viewerTimeZone}
            actions={agendaActions}
            warning={healthWarning}
            onGo={(target, filter) => {
              setAppFilter(filter ?? null);
              setView(target);
            }}
          />
        ) : null}
        {!searching && view === "agenda" ? (
          <AgendaView items={agenda} viewerTimeZone={viewerTimeZone} nowMs={nowMs} actions={agendaActions} />
        ) : null}
        {!searching && view === "calendar" ? (
          <CalendarView items={agenda} viewerTimeZone={viewerTimeZone} nowMs={nowMs} actions={agendaActions} />
        ) : null}
        {!searching && view === "pending" ? (
          <PendingView items={agenda} viewerTimeZone={viewerTimeZone} actions={agendaActions} />
        ) : null}
        {!searching && view === "applications" ? (
          <ApplicationsView
            key={appFilter ?? "all"}
            rows={applications}
            viewerTimeZone={viewerTimeZone}
            actions={applicationActions}
            initialFilter={appFilter ?? "all"}
          />
        ) : null}
        {!searching && view === "stats" ? <StatsView data={stats} /> : null}
        {!searching && view === "settings" ? (
          <SettingsView
            edits={edits}
            extra={settingsExtra}
            actions={{
              onUnblock: (address) => act(`已取消屏蔽 ${address}`, (e) => unblockSender(e, address)),
              onForgetName: (from) => act("已取消改名", (e) => forgetCompanyName(e, from)),
              onForgetZone: (company) => act(`已忘掉「${company}」的时区`, (e) => forgetCompanyZone(e, company)),
              onClearAll: () => act("已清空所有修改", () => EMPTY_EDITS),
            }}
          />
        ) : null}
        {!searching && view === "emails" ? emailGuide : null}
        {!searching && view === "emails" ? (
          <EmailView
            samples={samples}
            trashed={data.trashed}
            results={results}
            viewerTimeZone={viewerTimeZone}
            onDetail={openEmail}
            actions={emailActions}
          />
        ) : null}
      </section>

      {detail ? (
        <DetailPanel
          {...(prepare && liveDetailItem && canPrepare(liveDetailItem)
            ? (() => {
                const stored = edits.itemEdits[liveDetailItem.id];
                const note = stored?.note ?? null;
                return {
                  prep: {
                    exists: findPrepBlock(note) !== null,
                    edited: prepEdited(note, stored?.aiPrep),
                    busy: prepState?.itemId === liveDetailItem.id && prepState.busy,
                    error: prepState?.itemId === liveDetailItem.id ? prepState.error : null,
                    onGenerate: () => void generatePrep(liveDetailItem),
                  },
                };
              })()
            : {})}
          result={detail.result}
          emails={detailEmails}
          viewerTimeZone={viewerTimeZone}
          extractorNote={extractorNote}
          {...(detail.userNote ? { userNote: detail.userNote } : {})}
          {...(blockable && detail.sampleIds.length > 0
            ? (() => {
                const address = senderOfSample(detail.sampleIds[0] ?? "");
                if (address.length === 0) return {};
                return edits.blockedSenders.includes(address)
                  ? { blockedSender: address, onUnblock: () => { act(`已取消屏蔽 ${address}`, (e) => unblockSender(e, address)); setDetail(null); } }
                  : { sender: address, onBlock: () => { blockSenders(detail.sampleIds); setDetail(null); } };
              })()
            : {})}
          {...(detail.fromEmail && detail.sampleIds.length === 1
            ? (() => {
                const id = detail.sampleIds[0] as string;
                return edits.deletedEmails[id] !== undefined
                  ? { onRestoreEmail: () => { emailActions.onRestore([id]); setDetail(null); } }
                  : { onDeleteEmail: () => { emailActions.onDelete([id]); setDetail(null); } };
              })()
            : {})}
          {...(edits.companyNames[detail.result.company] !== undefined
            ? {
                renamedFrom: detail.result.company,
                onForgetName: () => {
                  const from = detail.result.company;
                  act("已取消改名", (e) => forgetCompanyName(e, from));
                  setDetail(null);
                },
              }
            : {})}
          {...(liveDetailItem
            ? {
                editedFields: liveDetailItem.editedFields,
                personalNote: liveDetailItem.note,
                onEdit: () => agendaActions.onEdit(liveDetailItem),
                ...(liveDetailItem.editedFields.length > 0 || liveDetailItem.note !== null
                  ? {
                      onRestore: () => {
                        const id = liveDetailItem.id;
                        act("已恢复系统判断", (e) => clearItemEdit(e, id));
                        setDetail(null);
                      },
                    }
                  : {}),
              }
            : {})}
          onClose={closeDetail}
        />
      ) : null}

      {form ? (
        <EventForm
          key={form.mode === "add" ? `add-${form.dateKey ?? ""}` : `${form.mode}-${form.item.id}`}
          title={form.mode === "confirm" ? "放进日程" : form.mode === "edit" ? "编辑" : "添加日程"}
          submitLabel={form.mode === "confirm" ? "确认，放进日程" : form.mode === "edit" ? "保存" : "添加"}
          lockIdentity={form.mode === "confirm"}
          showNote={form.mode === "edit"}
          renameFrom={form.mode === "edit" && form.item.origin === "email" && form.item.result.company.length > 0 ? form.item.result.company : null}
          rememberFor={form.mode !== "add" && form.item.result.company.length > 0 ? form.item.result.displayCompany || form.item.result.company : null}
          initial={
            form.mode === "confirm"
              ? confirmInitial(form.item, viewerTimeZone)
              : form.mode === "edit"
                ? editInitial(form.item, viewerTimeZone)
                : {
                  company: "",
                  role: "",
                  kind: "video_interview",
                  timeKind: "fixed_start",
                  local: form.dateKey ? `${form.dateKey}T10:00` : "",
                  timeZone: viewerTimeZone,
                }
          }
          viewerTimeZone={viewerTimeZone}
          {...(form.mode === "add" && quickParse ? { quickParse } : {})}
          onSubmit={submitForm}
          onCancel={closeForm}
        />
      ) : null}
      {/* 撤销提示压在详情面板和表单上面（z-60 > z-50）：详情里做的操作（比如 AI 面试准备）也要撤得了 */}
      {toast ? (
        <div
          key={toast.key}
          role="status"
          aria-live="polite"
          data-toast
          className="fixed inset-x-0 bottom-4 z-60 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-hairline bg-ink px-4 py-2.5 text-sm text-canvas shadow-lifted"
        >
          <span className="min-w-0 truncate">{toast.text}</span>
          {toast.canUndo && undoStack.length > 0 ? (
            <button type="button" onClick={undo} data-action="undo-last" className="shrink-0 font-semibold underline underline-offset-2">
              撤销
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 「放进日程」表单的预填值：系统已经读出来的部分照搬，读不出来的留空让用户填。 */
function confirmInitial(
  item: AgendaItem,
  viewerTimeZone: string,
): { company: string; role: string; kind: ReturnType<typeof kindIdOf>; timeKind: TimeKind; local: string; timeZone: string } {
  const { result } = item;
  const hasMoment = result.when !== null && result.when.viewer !== null;
  // 系统认出了时区就照它预填：表单里填的是「信里写的那个时间」，不是换算后的
  const timeZone = result.timeZone ?? viewerTimeZone;
  // 信里写了钟点、只是不知道是哪里的时间：照抄信里的数字预填，你只需要选时区
  const unzoned = hasMoment ? null : result.unzoned;
  const timeKind: TimeKind = unzoned
    ? unzoned.kind
    : result.dueType === "deadline"
      ? "deadline"
      : result.dueType === "unknown"
        ? "none"
        : "fixed_start";
  return {
    company: result.displayCompany.length > 0 ? result.displayCompany : "公司未认出",
    role: result.role ?? "",
    kind: kindIdOf(result.eventType, result.format),
    timeKind,
    timeZone,
    local: hasMoment && result.when ? utcToLocalInput(result.when.utc, timeZone) : (unzoned?.local ?? ""),
  };
}

/** 「编辑」表单的初始值：就是这件事现在显示的样子（含你之前改过的）。 */
function editInitial(
  item: AgendaItem,
  viewerTimeZone: string,
): { company: string; role: string; kind: ReturnType<typeof kindIdOf>; timeKind: TimeKind; local: string; timeZone: string; note: string } {
  const { result } = item;
  const timeZone = result.timeZone ?? viewerTimeZone;
  const hasMoment = result.when !== null;
  const timeKind: TimeKind = !hasMoment ? "none" : result.dueType === "deadline" ? "deadline" : "fixed_start";
  return {
    company: result.displayCompany.length > 0 ? result.displayCompany : result.company,
    role: result.role ?? "",
    kind: kindIdOf(result.eventType, result.format),
    timeKind,
    timeZone,
    local: hasMoment && result.when ? utcToLocalInput(result.when.utc, timeZone) : (result.unzoned?.local ?? ""),
    note: item.note ?? "",
  };
}
