"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ConfirmButton, ActionButton } from "@/components/demo/EventCard";
import { zoneLabel } from "@/lib/demo/parseDemo";
import type { UserEdits } from "@/lib/demo/userEdits";

export interface SettingsActions {
  onUnblock: (address: string) => void;
  onForgetName: (from: string) => void;
  onForgetZone: (company: string) => void;
  onClearAll: () => void;
}

/** 设置里的一组（私人看板传进来：日历与提醒、收信、AI 与简历）。 */
export interface SettingsGroup {
  id: string;
  title: string;
  hint?: string;
  content: React.ReactNode;
}

/**
 * 「设置」：按用途分组。私人看板在前面加自己的几组（日历与提醒、收信、AI 与简历），
 * 最后一组「数据与账号」两边都有：看板替你记住了什么、清空修改（私人看板再加退出登录）。
 * 宽屏左边一列小目录，窄屏是顶上一排；每组是一张能收起的卡片。
 */
export function SettingsView({
  edits,
  actions,
  groups = [],
  account,
}: {
  edits: UserEdits;
  actions: SettingsActions;
  groups?: readonly SettingsGroup[];
  /** 「数据与账号」最下面的私人看板部分（退出登录）。 */
  account?: React.ReactNode;
}) {
  const names = Object.entries(edits.companyNames);
  const zones = Object.entries(edits.companyZones);
  const nothingLearned = edits.blockedSenders.length === 0 && names.length === 0 && zones.length === 0;
  const data: SettingsGroup = {
    id: "data",
    title: "数据与账号",
    content: (
      <>
        <Section title="看板替你记住的" hint="你在详情、编辑里勾选「以后都这样」或点「这是广告」时记下的。删掉一条，以后就按系统自己的判断来。">
          {nothingLearned ? <p className="text-sm text-ink-faint">还没有记住任何东西。</p> : null}
          {edits.blockedSenders.length > 0 ? (
            <List title="标成广告的发件人（他们的信不再显示，收到也不调模型）">
              {edits.blockedSenders.map((address) => (
                <Item key={address} text={address}>
                  <ActionButton onClick={() => actions.onUnblock(address)} action="settings-unblock">
                    取消屏蔽
                  </ActionButton>
                </Item>
              ))}
            </List>
          ) : null}
          {names.length > 0 ? (
            <List title="公司改名（系统认出的 → 你要它显示的）">
              {names.map(([from, to]) => (
                <Item key={from} text={`${from} → ${to}`}>
                  <ActionButton onClick={() => actions.onForgetName(from)} action="settings-forget-name">
                    不再改名
                  </ActionButton>
                </Item>
              ))}
            </List>
          ) : null}
          {zones.length > 0 ? (
            <List title="公司时区（信里没写时区时按它算）">
              {zones.map(([company, zone]) => (
                <Item key={company} text={`${company} → ${zoneLabel(zone)}`}>
                  <ActionButton onClick={() => actions.onForgetZone(company)} action="settings-forget-zone">
                    忘掉
                  </ActionButton>
                </Item>
              ))}
            </List>
          ) : null}
        </Section>

        <Section title="清空我的所有修改" hint="确认、忽略、完成、编辑、删除、改名、屏蔽……全部回到系统自己的判断。邮件本身不会被删；日历提醒这类偏好设置也不受影响。">
          <ConfirmButton onConfirm={actions.onClearAll} confirmText="确认清空全部修改" action="clear-all">
            清空所有修改
          </ConfirmButton>
        </Section>

        {account}
      </>
    ),
  };
  const all = [...groups, data];
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const jump = (id: string) => {
    setClosed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className={all.length > 1 ? "md:grid md:grid-cols-[8.5rem_minmax(0,1fr)] md:gap-6" : ""}>
      {all.length > 1 ? (
        <nav aria-label="设置分组" className="mb-4 md:mb-0">
          <ul className="flex gap-1.5 overflow-x-auto pb-1 md:sticky md:top-4 md:flex-col md:overflow-visible md:pb-0">
            {all.map((group) => (
              <li key={group.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => jump(group.id)}
                  data-settings-nav={group.id}
                  className="w-full rounded-lg border border-hairline px-3 py-1.5 text-left text-xs text-ink-soft hover:bg-raised hover:text-ink md:border-transparent md:text-sm"
                >
                  {group.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <div className="max-w-3xl min-w-0 space-y-4">
        {all.map((group) => {
          const open = !closed.has(group.id);
          return (
            <section
              key={group.id}
              id={`settings-${group.id}`}
              aria-label={group.title}
              data-settings-group={group.id}
              className="scroll-mt-4 rounded-card border border-hairline bg-surface"
            >
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
              >
                <span>
                  <span className="block text-base font-semibold text-ink">{group.title}</span>
                  {group.hint ? <span className="mt-0.5 block text-xs text-ink-faint">{group.hint}</span> : null}
                </span>
                <ChevronDown size={16} aria-hidden className={`shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open ? <div className="space-y-6 border-t border-hairline px-4 py-4 sm:px-5">{group.content}</div> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-ink-faint">{hint}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function List({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-soft">{title}</p>
      <ul className="mt-1.5 space-y-1.5">{children}</ul>
    </div>
  );
}

function Item({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-surface px-4 py-2.5 text-sm">
      <span className="min-w-0 break-all text-ink">{text}</span>
      {children}
    </li>
  );
}
