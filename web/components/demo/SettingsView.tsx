"use client";

import { ConfirmButton, ActionButton } from "@/components/demo/EventCard";
import { zoneLabel } from "@/lib/demo/parseDemo";
import type { UserEdits } from "@/lib/demo/userEdits";

export interface SettingsActions {
  onUnblock: (address: string) => void;
  onForgetName: (from: string) => void;
  onForgetZone: (company: string) => void;
  onClearAll: () => void;
}

/**
 * 「设置」：看板替你记住了什么、能在哪里撤掉；以及（私人看板）日历订阅、数据状态、退出登录。
 * 这些以前散在各处（详情里的「不再改名」「取消屏蔽」、侧边栏的「撤销全部」），这里集中看得见。
 */
export function SettingsView({ edits, actions, extra }: { edits: UserEdits; actions: SettingsActions; extra?: React.ReactNode }) {
  const names = Object.entries(edits.companyNames);
  const zones = Object.entries(edits.companyZones);
  const nothingLearned = edits.blockedSenders.length === 0 && names.length === 0 && zones.length === 0;
  return (
    <div className="max-w-3xl space-y-8">
      {extra}

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

      <Section title="清空我的所有修改" hint="确认、忽略、完成、编辑、删除、改名、屏蔽……全部回到系统自己的判断。邮件本身不会被删。">
        <ConfirmButton onConfirm={actions.onClearAll} confirmText="确认清空全部修改" action="clear-all">
          清空所有修改
        </ConfirmButton>
      </Section>
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
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
