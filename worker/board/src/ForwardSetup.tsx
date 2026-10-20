import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CircleCheck, Copy, Mail, X } from "lucide-react";
import { ConfirmationItem } from "./ForwardingNotices";
import type { ForwardingNotice } from "./live";
import { useSession } from "./session";
import { BODY_KEYWORDS, SENDER_DOMAINS, SUBJECT_KEYWORDS, WIDE_KEYWORDS, WIDE_SENDER_DOMAINS } from "../../src/jobWords";

/**
 * 「让招聘邮件自动转过来」：按邮箱分开写的设置步骤。
 * 两种样子、同一份步骤：登录时弹出的翻页向导（SetupWizard，还没收到过信时），和「邮件」页里的完整列表（ForwardSetup）。
 * 每一步只做一件事；要复制的东西放在用到它的那一步；邮箱发来的确认（验证码 / 按钮）直接出现在「确认」那一步里。
 *
 * Gmail 用过滤器只转招聘信；QQ、163、Outlook 用「全部转发」，准点自己挑信（不像招聘信的当场丢掉）。
 * Gmail、QQ 收信规则、163 来信分类都实测过；QQ / 163 / Outlook 的「全部转发」还没实测（教程里写明了）。
 */

export type Provider = "gmail" | "qq" | "163" | "outlook" | "school" | "other";

const PROVIDERS: readonly { id: Provider; label: string }[] = [
  { id: "gmail", label: "Gmail" },
  { id: "qq", label: "QQ 邮箱" },
  { id: "163", label: "163 / 126" },
  { id: "outlook", label: "Outlook / Hotmail" },
  { id: "school", label: "学校邮箱" },
  { id: "other", label: "其他" },
];

// 词表和收信时「像不像招聘信」共用一份，在 worker/src/jobWords.ts 里改

/** Gmail 过滤器「包含字词」：关键词 OR 发件域名，一整段粘贴（Gmail 连正文一起搜）。 */
export const FILTER_QUERY = `(${WIDE_KEYWORDS.join(" OR ")}) OR from:(${WIDE_SENDER_DOMAINS.join(" OR ")})`;

/** 按登录邮箱猜一个默认选项。 */
export function guessProvider(email: string): Provider {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (domain === "qq.com" || domain === "foxmail.com") return "qq";
  if (["163.com", "126.com", "yeah.net"].includes(domain)) return "163";
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return "outlook";
  if (/\.edu(\.[a-z]{2})?$|\.ac\.[a-z]{2}$/.test(domain)) return "school";
  return "other";
}

function CopyChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <span className="mt-1.5 flex max-w-xl items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-sm text-ink select-all">{value}</code>
      <button type="button" onClick={copy} aria-label={label} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-on-brand-soft hover:bg-brand-soft">
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        {copied ? "已复制" : "复制"}
      </button>
    </span>
  );
}

/**
 * 一组词，点一个复制一个：复制过的打勾，下一个要复制的高亮，顶上数着「已复制 n / 共 m」。
 * 有的邮箱一次粘一串会变成一个长词（QQ、网易都是，10/16 实测），所以默认一个个加；另给一个「复制全部」试试。
 */
function WordChips({ words, label }: { words: readonly string[]; label: string }) {
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const [allCopied, setAllCopied] = useState(false);
  const next = words.find((w) => !done.has(w)) ?? null;
  const copy = (w: string) => {
    navigator.clipboard?.writeText(w).then(
      () => setDone((d) => new Set(d).add(w)),
      () => undefined,
    );
  };
  const copyAll = () => {
    navigator.clipboard?.writeText(words.join("\n")).then(
      () => {
        setAllCopied(true);
        window.setTimeout(() => setAllCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <span className="mt-2 block rounded-lg border border-hairline bg-surface p-2.5" data-word-chips={label}>
      <span className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-ink-soft">
          点一个词复制 → 粘贴到邮箱的框里 → <B>按回车</B>，再点下一个
        </span>
        <span className="font-semibold text-ink tabular" data-chips-progress>
          已复制 {done.size} / {words.length}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {words.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => copy(w)}
            title="点一下复制这个词"
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs ${
              done.has(w)
                ? "border-hairline bg-offer-soft text-on-offer-soft"
                : w === next
                  ? "border-accent bg-accent-soft text-ink ring-2 ring-accent"
                  : "border-hairline bg-canvas text-ink hover:bg-raised"
            }`}
          >
            {done.has(w) ? <Check size={11} aria-hidden /> : null}
            {w}
          </button>
        ))}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={copyAll} data-action="copy-all-words" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-on-brand-soft hover:bg-brand-soft">
            {allCopied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
            {allCopied ? "已复制全部" : `也可以试试一次复制全部 ${words.length} 个`}
          </button>
          <span className="text-xs text-ink-faint">粘贴后如果变成了一个长词，就删掉，改用上面一个个加。</span>
      </span>
    </span>
  );
}

/** 步骤里要点的按钮名、要填的值：加粗。 */
export const B = ({ children }: { children: React.ReactNode }) => <strong className="font-semibold text-ink">{children}</strong>;

type Step = React.ReactNode;

function steps(provider: Provider, inbox: string, confirm: React.ReactNode): { steps: Step[]; note?: React.ReactNode } {
  const address = <CopyChip value={inbox} label="复制收信地址" />;
  const subjectWords = <WordChips words={SUBJECT_KEYWORDS} label="subject" />;
  const bodyWords = <WordChips words={BODY_KEYWORDS} label="body" />;
  const senderWords = <WordChips words={SENDER_DOMAINS} label="sender" />;
  switch (provider) {
    case "gmail":
      return {
        steps: [
          <>用电脑打开 Gmail 网页版（手机 App 里没有这个设置），点右上角齿轮 → <B>查看所有设置</B>。</>,
          <>点 <B>转发和 POP/IMAP</B> 标签 → <B>添加转发地址</B>，粘贴你的收信地址 → <B>下一步</B> → <B>继续</B>。{address}</>,
          <>Gmail 会把确认发到准点，出现在下面。点 <B>一键确认转发</B>，或把验证码填回 Gmail 那一页 → <B>验证</B>。{confirm}</>,
          <>那一页保持 <B>停用转发</B> 就行：不是所有信都转，只转下一步挑出来的招聘信。</>,
          <>回到 Gmail 收件箱，点搜索框右边的 <B>显示搜索选项</B> 图标，在 <B>包含字词</B> 里粘贴下面这一整段（标题、正文带招聘词的，或者从招聘系统发来的，都会被挑出来）→ <B>创建过滤器</B>。<CopyChip value={FILTER_QUERY} label="复制过滤条件" /></>,
          <>勾选 <B>转发给</B>，选你的收信地址 → <B>创建过滤器</B>。完成。</>,
        ],
      };
    case "qq":
      return {
        steps: [
          <>用电脑打开 mail.qq.com（手机 App 里没有这个设置），进入 <B>设置</B>，在左边栏找 <B>邮件自动转发</B>（一般在 <B>发信设置</B> 或 <B>常规设置</B> 里）。</>,
          <>打开 <B>自动转发</B>，转发地址填你的收信地址，选 <B>转发后保留原邮件</B> → <B>保存</B>。{address}</>,
          <>QQ 会把确认信发到准点，下面会出现 <B>接受转发</B> 按钮，点它确认。{confirm}</>,
        ],
        note: "QQ 会把所有信都转过来，准点只留下像招聘信的（标题、正文带招聘词，或从招聘系统发来的），其余的当场丢掉：不保存，也不交给 AI。以前在「收信规则」里建过转发规则的可以删掉。QQ 的全部转发还没实际走过一遍，菜单名以你看到的为准。",
      };
    case "163":
      return {
        steps: [
          <>用电脑打开 mail.163.com（或 126.com），点顶部 <B>设置</B> → 左边栏 <B>常规设置</B>，往下找到 <B>自动回复/转发</B>。</>,
          <><B>自动转发</B> 勾上 <B>启用</B>，转发地址填你的收信地址（已经填了别的地址就点 <B>修改邮箱地址</B> 换掉；免费邮箱只能转一个地址），勾上保留原邮件 → 页面最下面点 <B>保存</B>。{address}</>,
          <>网易不用确认，保存后马上生效。发一封标题带「面试」的信到这个邮箱试一下，几分钟内会出现在准点。</>,
        ],
        note: "网易会把所有信都转过来，准点只留下像招聘信的（标题、正文带招聘词，或从招聘系统发来的），其余的当场丢掉：不保存，也不交给 AI。以前在「来信分类」里设过转发规则的可以删掉。网易的全部转发还没实际走过一遍，菜单名以你看到的为准。",
      };
    case "outlook":
      return {
        steps: [
          <>用电脑打开 outlook.com，点右上角齿轮 → <B>邮件</B> → <B>转发</B>。</>,
          <>打开 <B>启用转发</B>，转发地址填你的收信地址，勾上 <B>保留已转发邮件的副本</B> → <B>保存</B>。{address}</>,
          <>Outlook 一般不需要对方确认。如果有确认发来，会出现在下面。发一封标题带「面试」的信到这个邮箱试一下，几分钟内会出现在准点。{confirm}</>,
        ],
        note: "Outlook 会把所有信都转过来，准点只留下像招聘信的（标题、正文带招聘词，或从招聘系统发来的），其余的当场丢掉：不保存，也不交给 AI。Outlook 的全部转发还没实际走过一遍，菜单名以你看到的为准。",
      };
    case "school":
      return {
        steps: [
          <>先看你的学校邮箱是谁家的：登录页是 Google 的，选上面的 <B>Gmail</B> 照着做；是微软（Outlook / Office 365）的，往下看。</>,
          <>微软的学校邮箱，学校通常<B>禁止自动转发到外部邮箱</B>，设了也会被退回。可以先按 <B>Outlook</B> 的步骤试一次。</>,
          <>转不出来的话：招聘邮件尽量改用个人邮箱接收；学校邮箱里收到的，按「邮件」页的 <B>手动转发</B> 转一封进来，收件人填你的收信地址。{address}</>,
        ],
      };
    default:
      return {
        steps: [
          <>最简单：在你的邮箱设置里找 <B>自动转发</B>（全部转发），打开，转发地址填你的收信地址，保留原邮件，保存。准点只留下像招聘信的，其余的当场丢掉。{address}</>,
          <>邮箱只能「按规则转发」的话：新建一条规则，条件选满足任一条件，<B>主题包含</B> 这些词：{subjectWords}</>,
          <>如果有 <B>正文包含</B>，再加一条，填这几个词：{bodyWords}</>,
          <>再加一条：<B>发件人包含</B> 这些招聘系统；操作选 <B>转发到</B> 你的收信地址，保存：{senderWords}</>,
          <>邮箱发来的确认（按钮或验证码）会出现在下面。{confirm}</>,
        ],
        note: "找不到自动转发也没关系：按「邮件」页的「手动转发」，收到一封转一封。",
      };
  }
}

/** 选邮箱的按钮 + 「只收哪些邮箱转来的信」。 */
function ProviderPicker({ provider, onChange }: { provider: Provider; onChange: (p: Provider) => void }) {
  const { session } = useSession();
  const others = session.forwarders.filter((a) => a !== session.email);
  return (
    <div>
      <p className="text-sm font-semibold text-ink">你收招聘邮件用的是哪个邮箱？</p>
      <div role="tablist" aria-label="选择邮箱" className="mt-2 flex flex-wrap gap-1.5">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={provider === p.id}
            onClick={() => onChange(p.id)}
            data-provider={p.id}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              provider === p.id ? "border-brand-line bg-brand-soft font-semibold text-on-brand-soft" : "border-hairline text-ink-soft hover:bg-raised"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        准点只收 <B>{session.forwarders.join("、")}</B> 转来的信。{others.length === 0 ? "用别的邮箱转，先在「设置 → 收信」里加上它。" : ""}
      </p>
    </div>
  );
}

/** 「确认」那一步里放的东西：和所选邮箱对得上的确认信；还没有就提示刷新。 */
function confirmBlock(
  provider: Provider,
  confirmations: readonly ForwardingNotice[],
  viewerTimeZone: string,
  onConfirmDone: (id: string) => void,
  /** 在弹窗里时左下角的「刷新」被挡住了：直接在这里给一个。 */
  onRefresh?: () => void,
): React.ReactNode {
  // 选 Gmail 看 Gmail 的确认，选别的看其他邮箱的
  const relevant = confirmations.filter((n) => (provider === "gmail") === (n.provider === "gmail"));
  return relevant.length > 0 ? (
    <div className="mt-2 space-y-2" data-setup-confirm>
      {relevant.map((n) => (
        <ConfirmationItem key={n.id} notice={n} viewerTimeZone={viewerTimeZone} onDone={onConfirmDone} />
      ))}
    </div>
  ) : (
    <span className="mt-1 block text-xs text-ink-faint" data-setup-confirm-waiting>
      还没收到确认。做完上一步等一两分钟，
      {onRefresh ? (
        <button type="button" onClick={onRefresh} data-action="wizard-refresh" className="font-semibold text-on-brand-soft underline underline-offset-2">
          刷新看看
        </button>
      ) : (
        <>
          点左下角 <B>刷新</B>
        </>
      )}
      。
    </span>
  );
}

const BATCH_HINT = "以前收到的招聘信，自动转发不会补转：到「邮件」页的「手动转发 · 批量导入以前的信」，一次导进来。";

function SetupStatus({ emailCount }: { emailCount: number }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${emailCount > 0 ? "bg-offer-soft text-on-offer-soft" : "bg-raised text-ink-soft"}`} data-setup-status>
      {emailCount > 0 ? (
        <>
          <CircleCheck size={16} aria-hidden className="shrink-0" />
          已经收到 {emailCount} 封转来的信，转发是通的。
        </>
      ) : (
        <>还没收到转来的信。设好后，可以用别的邮箱给自己发一封标题带「面试」的信，一两分钟后点「刷新」，它出现在「邮件」页就说明通了。</>
      )}
    </div>
  );
}

interface SetupProps {
  emailCount: number;
  confirmations: readonly ForwardingNotice[];
  viewerTimeZone: string;
  /** 一封确认信处理完了（点了确认按钮或「已确认」）。 */
  onConfirmDone: (id: string) => void;
}

/** 「邮件」页里的完整列表：所有步骤一次列出来。 */
export function ForwardSetup({ emailCount, confirmations, viewerTimeZone, onConfirmDone }: SetupProps) {
  const { session } = useSession();
  const [provider, setProvider] = useState<Provider>(() => guessProvider(session.email));
  const { steps: list, note } = steps(provider, session.inbox, confirmBlock(provider, confirmations, viewerTimeZone, onConfirmDone));
  return (
    <section data-forward-setup={provider} className="mb-5 rounded-card border border-hairline bg-surface p-4 sm:p-5">
      <p className="text-sm text-ink-soft">在你的邮箱里设一次（约 3 分钟），以后招聘邮件会自己过来，自动排进日程。</p>
      <div className="mt-4">
        <ProviderPicker provider={provider} onChange={setProvider} />
      </div>
      <ol className="mt-5 space-y-4" data-setup-steps>
        {list.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-canvas tabular" aria-hidden>
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 text-sm leading-relaxed text-ink-soft">{step}</div>
          </li>
        ))}
      </ol>
      {note ? <p className="mt-4 text-xs text-ink-faint">{note}</p> : null}
      <p className="mt-3 text-xs text-ink-faint">{BATCH_HINT}</p>
      <div className="mt-5">
        <SetupStatus emailCount={emailCount} />
      </div>
    </section>
  );
}

/**
 * 登录时弹出的翻页向导：第 1 页选邮箱，之后一页一步，最后一页「设好了」。
 * 叉掉就关；页码记在打开它的那一方（App），重新打开时接着上次的页。
 */
export function SetupWizard({
  emailCount,
  confirmations,
  viewerTimeZone,
  onConfirmDone,
  onClose,
  page,
  onPage,
  chosen,
  onChoose,
  onRefresh,
}: SetupProps & {
  onClose: () => void;
  page: number;
  onPage: (page: number) => void;
  /** 选过的邮箱（关掉再打开时还记得）；没选过按登录邮箱猜。 */
  chosen: Provider | null;
  onChoose: (p: Provider) => void;
  onRefresh: () => void;
}) {
  const { session } = useSession();
  const provider = chosen ?? guessProvider(session.email);
  const setProvider = onChoose;
  const { steps: list, note } = steps(provider, session.inbox, confirmBlock(provider, confirmations, viewerTimeZone, onConfirmDone, onRefresh));
  const last = list.length + 1;
  const current = Math.min(page, last);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let content: React.ReactNode;
  if (current === 0) {
    content = (
      <>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent" aria-hidden>
            <Mail size={20} />
          </span>
          <div className="min-w-0">
            <h2 id="setup-wizard-title" className="text-lg font-semibold text-ink">
              第一步：让招聘邮件自动转到准点
            </h2>
            <p className="mt-1 text-sm text-ink-soft">在你的邮箱里设一次（约 3 分钟），以后招聘邮件会自己过来，自动排进日程、换算成你这里的时间。</p>
          </div>
        </div>
        <div className="mt-6">
          <ProviderPicker provider={provider} onChange={setProvider} />
        </div>
      </>
    );
  } else if (current <= list.length) {
    content = (
      <>
        <p className="text-xs font-semibold text-ink-faint tabular">
          {PROVIDERS.find((p) => p.id === provider)?.label} · 第 {current} / {list.length} 步
        </p>
        <div className="mt-3 text-base leading-relaxed text-ink-soft" data-wizard-step={current}>
          {list[current - 1]}
        </div>
        {current === list.length && note ? <p className="mt-4 text-xs text-ink-faint">{note}</p> : null}
      </>
    );
  } else {
    content = (
      <>
        <h2 className="text-lg font-semibold text-ink">设好了</h2>
        <div className="mt-4">
          <SetupStatus emailCount={emailCount} />
        </div>
        <p className="mt-4 text-sm text-ink-soft">{BATCH_HINT}</p>
        <p className="mt-2 text-sm text-ink-soft">这些步骤在「邮件」页的「自动转发设置」里随时能再看。</p>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-70 flex items-stretch justify-center bg-[var(--jcc-overlay)] sm:items-center sm:p-6" data-setup-wizard>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-wizard-title"
        className="relative flex max-h-full w-full flex-col overflow-hidden bg-surface shadow-lifted sm:max-w-xl sm:rounded-card sm:border sm:border-hairline"
      >
        <button type="button" onClick={onClose} aria-label="关闭" data-action="close-wizard" className="absolute top-3 right-3 rounded-lg p-2 text-ink-faint hover:bg-raised hover:text-ink">
          <X size={18} aria-hidden />
        </button>
        <div className="min-h-[18rem] flex-1 overflow-y-auto px-6 pt-8 pb-4 sm:px-8">{content}</div>
        <div className="flex items-center justify-between gap-3 border-t border-hairline px-6 py-4 sm:px-8">
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: last + 1 }, (_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === current ? "w-5 bg-ink" : "w-1.5 bg-hairline"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {current > 0 ? (
              <button type="button" onClick={() => onPage(current - 1)} data-action="wizard-prev" className="inline-flex items-center gap-1 rounded-lg border border-hairline px-3 py-2 text-sm text-ink-soft hover:bg-raised">
                <ChevronLeft size={15} aria-hidden />
                上一步
              </button>
            ) : null}
            {current < last ? (
              <button type="button" onClick={() => onPage(current + 1)} data-action="wizard-next" className="inline-flex items-center gap-1 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-canvas hover:opacity-90">
                {current === 0 ? "开始" : "下一步"}
                <ChevronRight size={15} aria-hidden />
              </button>
            ) : (
              <button type="button" onClick={onClose} data-action="wizard-done" className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-canvas hover:opacity-90">
                知道了
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
