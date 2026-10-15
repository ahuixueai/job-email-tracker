import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, Forward, MoreHorizontal, MoreVertical, RefreshCw, Reply, Search, Send } from "lucide-react";

/** 收信地址。Cloudflare Email Routing 里配的就是它。 */
export const INBOX_ADDRESS = "jobs@interviewtrack.me";

/**
 * 「邮件」页顶上的图文教程：怎么把一封信发进看板。
 * 图是**示意图**（按 Gmail 的布局简化画的），不是截图——按钮位置以你自己的 Gmail 为准。
 * 只在私人看板有：演示站没有收信地址。
 */
export interface SessionInfo {
  /** 只收哪些地址转来的信（和收信程序同一份配置）。 */
  forwarders: readonly string[];
  /** 登录的是谁。 */
  email: string | null;
}

/** 从服务端读登录信息。读到之前为 null。 */
export function useSessionInfo(): SessionInfo | null {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/session", { credentials: "same-origin" })
      .then((res) => res.json() as Promise<{ forwarders?: unknown; user?: { email?: unknown } }>)
      .then((body) => {
        if (!alive) return;
        setInfo({
          forwarders: Array.isArray(body.forwarders) ? body.forwarders.filter((a): a is string => typeof a === "string") : [],
          email: typeof body.user?.email === "string" ? body.user.email : null,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

export function useForwarders(): readonly string[] | null {
  return useSessionInfo()?.forwarders ?? null;
}

export function EmailGuide({ defaultOpen }: { defaultOpen: boolean }) {
  const forwarders = useForwarders();
  const [device, setDevice] = useState<"desktop" | "phone">(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? "desktop" : "phone",
  );
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(INBOX_ADDRESS).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  const sender = forwarders && forwarders.length > 0 ? forwarders.join("、") : "你设置的 Gmail";

  return (
    <details open={defaultOpen} data-email-guide className="group mb-5 rounded-card border border-hairline bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-ink">
          怎么把邮件发进来
          <span className="ml-2 font-normal text-ink-faint">转发到 {INBOX_ADDRESS}</span>
        </span>
        <ChevronDown size={16} aria-hidden className="shrink-0 text-ink-faint transition-transform group-open:rotate-180" />
      </summary>

      <div className="space-y-5 border-t border-hairline px-4 pt-4 pb-5">
        <div>
          <p className="text-xs text-ink-soft">收信地址</p>
          <div className="mt-1.5 flex max-w-md items-center gap-2 rounded-xl border border-hairline bg-canvas px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-ink select-all" data-inbox-address>
              {INBOX_ADDRESS}
            </code>
            <button type="button" onClick={copy} aria-label="复制收信地址" className="shrink-0 rounded-lg p-1.5 text-ink-soft hover:bg-raised">
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft" data-forwarders>
            只收从 <strong className="font-semibold text-ink">{sender}</strong> 转来的信。用别的邮箱发过来会被直接拒收，看板上看不到。
          </p>
        </div>

        <div>
          <p className="text-sm font-semibold text-ink">自动转发：已经设好，不用管</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            Gmail 里的过滤器会把招聘邮件自动转过来，一般一分钟内出现在这里。漏掉的（或者在过滤器设好之前收到的），按下面的步骤手动转一封就行。
            想改过滤器：Gmail 网页版右上角齿轮 → 查看所有设置 → 过滤器和屏蔽的地址 → 找到「转发到 {INBOX_ADDRESS}」那条 → 修改。
          </p>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">手动转发一封</p>
            <div role="tablist" aria-label="在哪转发" className="inline-flex rounded-lg border border-hairline p-0.5 text-xs">
              {(
                [
                  ["desktop", "电脑 · Gmail 网页版"],
                  ["phone", "手机 · Gmail App"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={device === id}
                  onClick={() => setDevice(id)}
                  data-guide-device={id}
                  className={`rounded-md px-2.5 py-1 ${device === id ? "bg-brand-soft font-semibold text-on-brand-soft" : "text-ink-soft hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3" data-guide-steps={device}>
            {(device === "desktop" ? DESKTOP_STEPS : PHONE_STEPS).map((step, i) => (
              <li key={step.title} className="flex flex-col rounded-xl border border-hairline bg-canvas p-3">
                <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-raised/60 p-2" aria-hidden>
                  {step.picture}
                </div>
                <p className="mt-3 text-sm font-semibold text-ink">
                  <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-full bg-accent text-xs text-on-accent tabular">{i + 1}</span>
                  {step.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">{step.text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-ink-faint">示意图：按 Gmail 的布局简化画的，按钮位置以你的 Gmail 为准。</p>
        </div>

        <div>
          <p className="text-sm font-semibold text-ink">几点要注意</p>
          <ul className="mt-1 space-y-1 text-xs leading-relaxed text-ink-soft">
            <li>· 转发时别删掉自动带上的「Forwarded message / 已转发的邮件」那一段：看板靠它认出原发件人和原主题。</li>
            <li>· 收到就转。信里写「72 小时内完成」这类期限时，看板按<strong className="font-semibold text-ink">你转发的时刻</strong>起算；隔几天再转，算出来的截止时间会偏晚。</li>
            <li>· 转过来的广告会自动收进下面的「已忽略」；整个发件人都不想要，点那封信的「这是广告」。</li>
            <li>· 发完回到这里点左下角「刷新」（页面切回来时也会自动刷新）。</li>
          </ul>
        </div>
      </div>
    </details>
  );
}

/** 示意图里被圈出来要点的那个东西。 */
function Hot({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <span className="relative inline-flex">
      <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-ink ring-2 ring-accent">{children}</span>
      {label ? (
        <span className="absolute top-full right-0 mt-1 rounded bg-ink px-1.5 py-0.5 text-[10px] whitespace-nowrap text-canvas">{label}</span>
      ) : null}
    </span>
  );
}

const Line = ({ w }: { w: string }) => <span className={`block h-1.5 rounded-full bg-hairline ${w}`} />;

/** 电脑上的 Gmail 窗口框。 */
function Desk({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[15rem] overflow-hidden rounded-md border border-hairline bg-surface text-[11px] text-ink shadow-card">
      <div className="flex items-center gap-1 border-b border-hairline px-2 py-1">
        <span className="size-1.5 rounded-full bg-hairline" />
        <span className="size-1.5 rounded-full bg-hairline" />
        <span className="ml-2 flex flex-1 items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-ink-faint">
          <Search size={9} />
          搜索邮件
        </span>
      </div>
      <div className="space-y-1.5 p-2">{children}</div>
    </div>
  );
}

/** 手机框。 */
function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full max-h-[11rem] w-[6.5rem] overflow-hidden rounded-xl border-2 border-hairline bg-surface p-1.5 text-[10px] text-ink shadow-card">
      <div className="mx-auto mb-1.5 h-1 w-6 rounded-full bg-hairline" />
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

const SUBJECT = "【示例公司】面试邀请";

const DESKTOP_STEPS: readonly { title: string; text: string; picture: React.ReactNode }[] = [
  {
    title: "打开那封信，点「转发」",
    text: "在信的右上角点「⋮」→「转发」；也可以直接点信末尾的「转发」按钮。",
    picture: (
      <Desk>
        <div className="flex items-center justify-between gap-1">
          <span className="truncate font-semibold">{SUBJECT}</span>
          <span className="flex items-center gap-1 text-ink-faint">
            <Reply size={10} />
            <Hot label="转发">
              <MoreVertical size={10} />
            </Hot>
          </span>
        </div>
        <Line w="w-3/4" />
        <Line w="w-full" />
        <Line w="w-2/3" />
        <div className="flex gap-1 pt-1">
          <span className="rounded-full border border-hairline px-1.5 py-0.5 text-ink-faint">↩ 回复</span>
          <span className="rounded-full border border-hairline px-1.5 py-0.5 text-ink-faint">↪ 转发</span>
        </div>
      </Desk>
    ),
  },
  {
    title: "收件人填收信地址",
    text: `收件人填 ${INBOX_ADDRESS}。正文不用写；下面自动带上的那段原信别删。`,
    picture: (
      <Desk>
        <div className="flex items-center gap-1 border-b border-hairline pb-1">
          <span className="text-ink-faint">收件人</span>
          <Hot>
            <span className="font-mono text-[10px]">{INBOX_ADDRESS}</span>
          </Hot>
        </div>
        <div className="truncate border-b border-hairline pb-1 text-ink-soft">Fwd: {SUBJECT}</div>
        <div className="rounded border border-dashed border-ink-faint px-1 py-0.5 text-[9px] text-ink-soft">---------- Forwarded message ---------</div>
        <Line w="w-full" />
        <Line w="w-1/2" />
      </Desk>
    ),
  },
  {
    title: "发送，回看板刷新",
    text: "点「发送」。一分钟内回到看板点「刷新」，这封信就出现在上面。",
    picture: (
      <Desk>
        <div className="truncate text-ink-soft">Fwd: {SUBJECT}</div>
        <Line w="w-full" />
        <Line w="w-3/4" />
        <div className="flex items-center justify-between pt-2">
          <Hot>
            <span className="px-1 font-semibold">发送</span>
          </Hot>
          <span className="flex items-center gap-1 text-ink-faint">
            <RefreshCw size={9} />
            看板「刷新」
          </span>
        </div>
      </Desk>
    ),
  },
];

const PHONE_STEPS: readonly { title: string; text: string; picture: React.ReactNode }[] = [
  {
    title: "打开那封信，点右上角「⋯」",
    text: "在 Gmail App 里打开要转的信，点右上角的三个点。",
    picture: (
      <Phone>
        <div className="flex items-center justify-between">
          <span className="text-ink-faint">‹</span>
          <Hot>
            <MoreHorizontal size={10} />
          </Hot>
        </div>
        <div className="font-semibold leading-tight">{SUBJECT}</div>
        <Line w="w-full" />
        <Line w="w-3/4" />
        <Line w="w-full" />
      </Phone>
    ),
  },
  {
    title: "选「转发」",
    text: "在弹出的菜单里选「转发」。",
    picture: (
      <Phone>
        <div className="font-semibold leading-tight text-ink-faint">{SUBJECT}</div>
        <Line w="w-3/4" />
        <div className="mt-2 space-y-1 rounded-lg border border-hairline bg-canvas p-1.5">
          <div className="flex items-center gap-1 text-ink-soft">
            <Reply size={9} />
            回复
          </div>
          <Hot>
            <Forward size={9} />
            转发
          </Hot>
        </div>
      </Phone>
    ),
  },
  {
    title: "填地址，点发送",
    text: `收件人填 ${INBOX_ADDRESS}，点右上角的纸飞机发送。`,
    picture: (
      <Phone>
        <div className="flex items-center justify-between">
          <span className="text-ink-faint">×</span>
          <Hot>
            <Send size={9} />
          </Hot>
        </div>
        <div className="border-b border-hairline pb-0.5 text-ink-faint">收件人</div>
        <div className="break-all">
          <Hot>
            <span className="font-mono text-[8px]">{INBOX_ADDRESS}</span>
          </Hot>
        </div>
        <Line w="w-full" />
        <Line w="w-2/3" />
      </Phone>
    ),
  },
];
