"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { KindChip } from "@/components/demo/EventCard";
import { highlightSegments } from "@/lib/demo/highlight";
import type { Mark, MarkKind } from "@/lib/demo/highlight";
import {
  collectAccess,
  CONFIDENCE_LABEL,
  DESTINATION_HINT,
  DESTINATION_LABEL,
  DUE_HINT,
  zoneLabel,
} from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";
import type { SampleEmail } from "@/lib/demo/sampleEmails";

const MARK_STYLE: Readonly<Record<MarkKind, string>> = {
  time: "bg-accent text-on-accent",
  company: "bg-brand-soft text-on-brand-soft",
  role: "bg-offer-soft text-on-offer-soft",
  location: "bg-drop-soft text-on-drop-soft",
};

const MARK_LABEL: Readonly<Record<MarkKind, string>> = {
  company: "公司",
  role: "岗位",
  time: "时间",
  location: "地点",
};

function marksOf(result: DemoResult | undefined): Mark[] {
  const e = result?.extraction;
  if (!e) return [];
  return [
    { kind: "time", fragment: e.timeText },
    { kind: "company", fragment: e.companyRaw },
    { kind: "role", fragment: e.roleRaw },
    { kind: "location", fragment: e.locationRaw },
  ];
}

function Highlighted({ text, marks }: { text: string; marks: readonly Mark[] }) {
  return (
    <>
      {highlightSegments(text, marks).map((segment, i) =>
        segment.kind === null ? (
          <span key={i}>{segment.text}</span>
        ) : (
          <mark
            key={i}
            data-mark={segment.kind}
            title={MARK_LABEL[segment.kind]}
            className={`rounded px-0.5 ${MARK_STYLE[segment.kind]}`}
          >
            {segment.text}
          </mark>
        ),
      )}
    </>
  );
}

export interface DetailEmail {
  sample: SampleEmail;
  /** 这一封自己的解析结果，用于高亮它自己被摘出的片段。 */
  result: DemoResult | undefined;
}

/**
 * 详情面板：卡片上没放的一切都在这里。
 * 顺序是「结论 → 时间怎么换算 → 原文（高亮） → 系统为什么这么判」。
 */
export function DetailPanel({
  result,
  emails,
  viewerTimeZone,
  extractorNote,
  userNote,
  onClose,
}: {
  result: DemoResult;
  emails: readonly DetailEmail[];
  viewerTimeZone: string;
  extractorNote: string;
  /** 这条结论里有用户手动的部分时，说明是哪一部分。 */
  userNote?: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dropped = result.destination === "dropped";
  // 合并的事把几封信里的链接和密钥并到一起：催办信里常常不再重复密钥
  const access = collectAccess(emails.map((email) => email.result));
  const hasAccess = access.links.length > 0 || access.credentials.length > 0;
  const company = result.displayCompany.length > 0 ? result.displayCompany : "公司未认出";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-detail-panel>
      <button
        type="button"
        aria-label="关闭详情"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-(--jcc-overlay)"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="详情"
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-hairline bg-canvas shadow-lifted"
      >
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-hairline bg-canvas px-5 py-4">
          <div className="min-w-0 flex-1">
            {dropped ? (
              <p className="text-lg font-semibold text-ink">{DESTINATION_LABEL.dropped}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <KindChip result={result} />
                </div>
                <p className="mt-2 text-lg font-semibold break-words text-ink">{company}</p>
                <p className="text-sm break-words text-ink-soft">{result.role ?? "岗位未写明"}</p>
              </>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-ink-soft hover:bg-raised"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          {userNote ? (
            <p className="rounded-xl bg-brand-soft px-4 py-3 text-sm leading-relaxed text-on-brand-soft" data-user-note>
              {userNote}
            </p>
          ) : null}
          {dropped ? (
            <p className="text-sm leading-relaxed text-ink-soft">
              {DESTINATION_HINT.dropped} {result.trace[0]?.reason}
            </p>
          ) : (
            <Section title="时间">
              <TimeBlock result={result} viewerTimeZone={viewerTimeZone} />
            </Section>
          )}

          {!dropped && hasAccess ? (
            <Section title="入口与密钥">
              <div className="space-y-2 rounded-xl border border-hairline bg-surface p-4" data-access>
                {access.links.map((link, i) => (
                  <AccessRow key={link} label={i === 0 ? "入口链接" : "其他链接"} value={link} href={link} />
                ))}
                {access.credentials.map((credential) => (
                  <AccessRow key={credential.value} label={credential.label} value={credential.value} />
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                从邮件原文逐字摘出，没有经过模型。点开链接前请核对网址是不是这家公司的。
              </p>
            </Section>
          ) : null}

          {emails.length === 0 ? null : (
          <Section title={emails.length > 1 ? `来自 ${emails.length} 封邮件` : "邮件原文"}>
            <div className="space-y-3">
              {emails.map(({ sample, result: own }) => (
                <article key={sample.id} className="rounded-xl border border-hairline bg-surface p-4">
                  <p className="text-xs break-words text-ink-faint">{sample.raw.from}</p>
                  <h4 className="mt-1 text-sm font-semibold text-ink">
                    <Highlighted text={sample.raw.subject} marks={marksOf(own)} />
                  </h4>
                  <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
                    <Highlighted text={sample.raw.body} marks={marksOf(own)} />
                  </p>
                </article>
              ))}
              {dropped ? null : (
                <p className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  高亮：
                  {(Object.keys(MARK_LABEL) as MarkKind[]).map((kind) => (
                    <span key={kind} className={`rounded px-1.5 py-0.5 ${MARK_STYLE[kind]}`}>
                      {MARK_LABEL[kind]}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </Section>
          )}

          {dropped || result.trace.length === 0 ? null : (
            <Section title="系统是怎么判断的">
              <p className="text-sm leading-relaxed text-ink-soft">
                {DESTINATION_HINT[result.destination]}
                {result.confidence ? ` 把握：${CONFIDENCE_LABEL[result.confidence]}。` : null}
              </p>
              {result.confidenceReasons.length > 0 ? (
                <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                  {result.confidenceReasons.join("；")}
                </p>
              ) : null}
              <ol className="mt-3 space-y-2.5">
                {result.trace.map((step) => (
                  <li key={step.label} className="grid grid-cols-[5rem_1fr] gap-x-3 text-sm">
                    <span className="text-ink-soft">{step.label}</span>
                    <span className="min-w-0">
                      <span className="text-ink">{step.value}</span>
                      {step.reason.length > 0 ? (
                        <span className="block text-xs leading-relaxed break-words text-ink-faint">
                          {step.reason}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">{extractorNote}</p>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 一行链接或凭据：标签 + 值 + 复制按钮。
 * 值用等宽字体整段显示、允许折行但不省略——密钥少看一位就登不进去。
 */
function AccessRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    // 剪贴板在部分浏览器与内嵌环境里会被拒绝；失败时什么都不显示，用户仍可手动选中复制
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <div className="grid grid-cols-[5.5rem_1fr_auto] items-start gap-x-3 text-sm">
      <span className="pt-0.5 text-ink-soft">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 font-mono text-[13px] break-all text-ink underline underline-offset-2"
        >
          {value}
        </a>
      ) : (
        <code className="min-w-0 font-mono text-[13px] break-all text-ink select-all">{value}</code>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={`复制${label}`}
        className="rounded-lg p-1 text-ink-soft hover:bg-raised"
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold tracking-wide text-ink-soft">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function TimeBlock({ result, viewerTimeZone }: { result: DemoResult; viewerTimeZone: string }) {
  if (result.when === null || result.when.source === null || result.timeZone === null) {
    // 定不下来的原因每封信不同，用引擎自己给的理由
    return <p className="text-sm leading-relaxed text-ink-soft">{result.dueReason}</p>;
  }
  const hint = result.dueType ? DUE_HINT[result.dueType] : undefined;
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <dl className="tabular grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-ink-soft">你这里</dt>
        <dd className="font-semibold text-ink">
          {result.when.viewer}
          <span className="ml-2 text-xs font-normal text-ink-faint">{zoneLabel(viewerTimeZone)}</span>
        </dd>
        {result.when.sameZone ? null : (
          <>
            <dt className="text-ink-soft">当地</dt>
            <dd className="text-ink">
              {result.when.source}
              <span className="ml-2 text-xs text-ink-faint">{zoneLabel(result.timeZone)}</span>
            </dd>
          </>
        )}
      </dl>
      {hint ? <p className="mt-3 text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
}
