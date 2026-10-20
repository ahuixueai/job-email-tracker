import { useState } from "react";
import { Check, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { formatWallClock } from "@/lib/demo/parseDemo";
import type { ForwardingNotice } from "./live";

/**
 * 「邮箱转发确认」：开通自动转发时，邮箱服务商发来的验证码 / 确认链接，单独放一栏。
 * 不挑邮箱：有服务商自己域名的链接就做成按钮，有验证码就大字显示，都认不出就把正文开头给人看。
 * 只显示最近 7 天的；没有就整栏不出现。
 */
export function ForwardingNotices({ notices, viewerTimeZone, onDone }: { notices: readonly ForwardingNotice[]; viewerTimeZone: string; onDone: (id: string) => void }) {
  if (notices.length === 0) return null;
  return (
    <section data-forwarding-notices className="mb-5 rounded-card border-2 border-accent bg-surface p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} aria-hidden className="shrink-0 text-ink" />
        <h2 className="text-base font-semibold text-ink">邮箱转发确认</h2>
      </div>
      <p className="mt-1 text-sm text-ink-soft">开通自动转发时，邮箱发来的确认。做完一次，之后招聘邮件就会自动转过来。</p>
      <ul className="mt-4 space-y-3">
        {notices.map((notice) => (
          <li key={notice.id}>
            <ConfirmationItem notice={notice} viewerTimeZone={viewerTimeZone} onDone={onDone} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 一封确认信：验证码（大字 + 复制）、确认按钮、认不出时的正文开头。
 * 点了确认按钮（或点「已完成」）就把这条提醒删掉，不再出现；确认没成功的话，在邮箱里重新申请一次，会来一封新的。
 */
export function ConfirmationItem({ notice, viewerTimeZone, onDone }: { notice: ForwardingNotice; viewerTimeZone: string; onDone: (id: string) => void }) {
  const done = () => onDone(notice.id);
  return (
    <div data-forwarding-notice={notice.provider} className="rounded-xl border border-hairline bg-canvas p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-ink">{notice.provider === "gmail" ? "Gmail 转发确认" : notice.subject}</p>
        <p className="text-xs text-ink-faint tabular">收到于 {formatWallClock(notice.receivedAt, viewerTimeZone)}</p>
      </div>
      {notice.links.length > 0 ? <ConfirmLinks links={notice.links} onConfirm={done} /> : null}
      {notice.code !== null ? <Code code={notice.code} hasLink={notice.links.length > 0} /> : null}
      {notice.links.length === 0 && notice.code === null ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-sm text-ink-soft">没认出确认按钮或验证码，下面是这封信的开头，按信里说的做：</p>
          <p className="max-h-40 overflow-y-auto rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-ink-soft">{notice.excerpt}</p>
        </div>
      ) : null}
      {notice.links.length === 0 ? (
        <button type="button" onClick={done} data-action="confirm-done" className="mt-3 rounded-lg border border-hairline px-3 py-1.5 text-sm text-ink-soft hover:bg-raised">
          我已确认好了，不再显示
        </button>
      ) : null}
    </div>
  );
}

function Code({ code, hasLink }: { code: string; hasLink: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <div className="mt-3 space-y-2">
      {hasLink ? <p className="text-xs text-ink-faint">按钮点不开的话，也可以用验证码：</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-2xl font-semibold tracking-[0.15em] text-ink tabular select-all" data-forwarding-code>
          {code}
        </span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-sm text-ink-soft hover:bg-raised">
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied ? "已复制" : "复制验证码"}
        </button>
      </div>
      <p className="text-sm text-ink-soft">回到邮箱里设置转发的那一页，把这串数字填进去，点「验证」。</p>
    </div>
  );
}

function ConfirmLinks({ links, onConfirm }: { links: readonly { label: string; url: string }[]; onConfirm: () => void }) {
  // 「接受 / 确认」那个按钮最显眼；「取消」之类的放成小字
  const primary = links.find((l) => /接受|确认|同意|verify|confirm|accept/i.test(l.label) && !/取消|拒绝|cancel/i.test(l.label)) ?? links[0]!;
  const others = links.filter((l) => l !== primary);
  return (
    <div className="mt-3 space-y-2">
      <a
        href={primary.url}
        target="_blank"
        rel="noopener noreferrer"
        data-forwarding-confirm
        onClick={onConfirm}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:opacity-90"
      >
        {primary.label}
        <ExternalLink size={14} aria-hidden />
      </a>
      <p className="text-sm text-ink-soft">点按钮，在打开的页面里确认，就开通了（点过之后这条会收起）。按钮打开的是邮箱服务商自己的网页。</p>
      {others.length > 0 ? (
        <p className="text-xs text-ink-faint">
          {others.map((l, i) => (
            <span key={l.url}>
              {i > 0 ? "　" : ""}
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink-soft">
                {l.label}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
