import { dedupKeyOf, parseEmail, route, StubExtractor } from "../tracker-core/index";
import type {
  Confidence,
  Credential,
  DueType,
  EventFormat,
  EventType,
  Extraction,
  LLMExtractor,
  RawEmail,
} from "../tracker-core/index";

/**
 * 解析演示页的视图模型。
 *
 * 这一层只做一件事：把 tracker-core 的解析结果翻译成页面能直接渲染的中文结构。
 * **不在这里加任何判定逻辑**——页面展示的每一条结论都必须是引擎自己给的，
 * 否则演示的就不是产品，是演示页自己。
 */

export const EVENT_LABEL: Readonly<Record<EventType, string>> = {
  application_ok: "投递成功",
  assessment: "测评",
  interview: "面试",
  result: "结果通知",
  reminder: "催办提醒",
  update: "流程更新",
  other: "未识别",
};

/** 形式的叫法。unspecified / not_applicable 不在这里——它们没有自己的名字，退回事件类型。 */
export const FORMAT_LABEL: Readonly<Partial<Record<EventFormat, string>>> = {
  online_assessment: "在线测评",
  written_test: "笔试",
  ai_interview: "AI 面试",
  phone_interview: "电话面试",
  video_interview: "视频面试",
  onsite_interview: "线下面试",
};

/**
 * 卡片上「这是什么事」的那个词。能说出形式就说形式（「电话面试」比「面试」有用），
 * 说不出时退回事件类型，并如实带上「形式未说明」。
 */
export function kindLabelOf(eventType: EventType, format: EventFormat): string {
  const named = FORMAT_LABEL[format];
  if (named !== undefined) return named;
  if (format === "unspecified") return `${EVENT_LABEL[eventType]}（形式未说明）`;
  return EVENT_LABEL[eventType];
}

export const DUE_LABEL: Readonly<Record<DueType, string>> = {
  fixed_start: "准点开始",
  deadline: "截止前完成",
  date_only: "只知道日期",
  unknown: "没有时间",
};

/**
 * 只有场次与期限有固定含义。date_only / unknown 的成因每封信不同
 * （没写钟点、写了钟点但时区未知……），页面直接显示引擎给的理由，不在这里概括。
 */
export const DUE_HINT: Readonly<Partial<Record<DueType, string>>> = {
  fixed_start: "必须在这个时刻到场，迟到即失去资格",
  deadline: "在此之前随时完成都可以",
};

export const CONFIDENCE_LABEL: Readonly<Record<Confidence, string>> = {
  high: "高",
  medium: "中",
  low: "低",
};

export type Destination = "board" | "pending" | "noise" | "dropped";

export const DESTINATION_LABEL: Readonly<Record<Destination, string>> = {
  board: "已排进日程",
  pending: "待你确认",
  noise: "已折叠",
  dropped: "已忽略",
};

export const DESTINATION_HINT: Readonly<Record<Destination, string>> = {
  board: "把握足够，直接排进日程并参与提醒。",
  pending: "认得出是什么事，但有关键信息拿不准。摆出来请你确认，不擅自排进日程。",
  noise: "连是什么事都认不出。收起来但保留，随时可以找回。",
  dropped: "不是求职事件，不进入后续解析。",
};

/** 常见时区的中文叫法。演示页面向普通读者，不显示 `Asia/Shanghai` 这种写法。 */
const ZONE_NAME: Readonly<Record<string, string>> = {
  "Asia/Shanghai": "北京时间",
  "Asia/Hong_Kong": "香港时间",
  "Asia/Singapore": "新加坡时间",
  "Asia/Tokyo": "东京时间",
  "Asia/Dubai": "迪拜时间",
  "Europe/London": "伦敦时间",
  "America/New_York": "纽约时间",
  "America/Chicago": "芝加哥时间",
  "America/Los_Angeles": "洛杉矶时间",
  UTC: "协调世界时",
};

/** 表里没有的时区退回城市名（`Europe/Paris` → `Paris 时间`），总比整串 IANA 名好读。 */
export function zoneLabel(timeZone: string): string {
  const named = ZONE_NAME[timeZone];
  if (named !== undefined) return named;
  const city = timeZone.split("/").pop() ?? timeZone;
  return `${city.replace(/_/g, " ")} 时间`;
}

export interface TraceStep {
  /** 这一步在做什么。 */
  label: string;
  /** 得出的结论。 */
  value: string;
  /** 依据。引擎没有给出依据时为空串。 */
  reason: string;
}

export interface DemoWhen {
  /** 事件所在地的显示串。时区未知时为 null。 */
  source: string | null;
  /** 观察者所在地的显示串。 */
  viewer: string | null;
  /** 两地是否同一时区。true 时页面只显示一行。 */
  sameZone: boolean;
  /** 原始 UTC 时刻。 */
  utc: string;
}

export interface DemoResult {
  destination: Destination;
  /** 归一化后的公司名，用于合并。 */
  company: string;
  /** 展示用的公司名：优先用信里的原名，合并才用归一名。 */
  displayCompany: string;
  /** 岗位名。没摘到为 null。 */
  role: string | null;
  eventType: EventType | null;
  format: EventFormat | null;
  /** 卡片上「这是什么事」的那个词。 */
  kindLabel: string;
  dueType: DueType | null;
  /** 引擎对时间语义给出的理由。 */
  dueReason: string;
  when: DemoWhen | null;
  timeZone: string | null;
  confidence: Confidence | null;
  /** 降级原因。高置信时为空。 */
  confidenceReasons: readonly string[];
  /** 「同一件事」的归一化键。丢弃的邮件没有。 */
  dedupKey: string | null;
  /** 抽取层摘出的原文片段。 */
  extraction: Extraction | null;
  /** 入口链接：测评、笔试、会议的地址。规则从原文逐字摘出。 */
  links: readonly string[];
  /** 凭据：测评密钥、考试码、会议号等。规则从原文逐字摘出。 */
  credentials: readonly Credential[];
  trace: readonly TraceStep[];
}

const TZ_SOURCE_LABEL: Readonly<Record<string, string>> = {
  explicit: "信里写明的时区",
  location: "信里出现的地点",
  domain: "发件域名",
  ledger: "这家公司的历史记录",
  none: "没有线索",
};

/** 「10月14日 周三 19:00」。自己排版而不是用 toLocaleString，各浏览器输出才一致。 */
export function formatWallClock(utc: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utc));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("month")}月${get("day")}日 ${get("weekday")} ${hour}:${get("minute")}`;
}

export function describeWhen(utc: string, sourceTz: string | null, viewerTz: string): DemoWhen {
  if (sourceTz === null) {
    // 时区推断不出时不渲染事件所在地的时刻——那会是一个自信而错误的钟点。
    return { source: null, viewer: null, sameZone: false, utc };
  }
  const source = formatWallClock(utc, sourceTz);
  const viewer = formatWallClock(utc, viewerTz);
  // 比的是这一刻两地的墙上时间，不是时区名：纽约与多伦多名字不同但钟点相同。
  return { source, viewer, sameZone: source === viewer, utc };
}

/**
 * 卡片上的岗位名。模型有时把公司名一起摘进岗位（「云帆物流 2027 届管理培训生」），
 * 而公司已经单独显示在上一行，重复一遍只是噪音。只去掉开头那一处，别的不动；
 * 去完什么都不剩就保留原样。高亮用的仍是模型摘的原文片段，不受这里影响。
 */
export function displayRole(roleRaw: string | null, company: string): string | null {
  if (roleRaw === null) return null;
  if (company.length === 0 || !roleRaw.startsWith(company)) return roleRaw;
  const rest = roleRaw.slice(company.length).replace(/^[\s·\-—:：,，]+/, "");
  return rest.length > 0 ? rest : roleRaw;
}

export interface TimeSummary {
  /** 卡片上那一行时间。 */
  text: string;
  /** 这是哪里的时间。没有确切时刻时为 null。 */
  zone: string | null;
}

/**
 * 卡片上的时间：**按看的人所在时区**显示。人是照着自己的钟安排一天的，
 * 事件当地的钟点放在详情里。截止期限带「前」字，和准点开始区分开。
 */
export function timeSummary(result: DemoResult, viewerTimeZone: string): TimeSummary {
  if (result.when !== null && result.when.viewer !== null) {
    const suffix = result.dueType === "deadline" ? " 前" : "";
    return { text: `${result.when.viewer}${suffix}`, zone: zoneLabel(viewerTimeZone) };
  }
  // 拿不准的和本来就没有时间的要分开说：前者需要用户补，后者不需要
  if (result.destination === "pending") return { text: "时间待确认", zone: null };
  return { text: "没有具体时间", zone: null };
}

/**
 * 待确认卡片上那句「为什么拿不准」，用平常话说。
 *
 * 引擎给的理由是写给排查问题的人看的（「时间语义置信度为 low」），详情里原样保留；
 * 卡片上要的是用户一眼能懂、知道自己该补什么的一句话。这里只是**换个说法**，
 * 不新增判断——对不上任何一种已知理由时，老实说「详情里有具体原因」。
 */
export function pendingReason(result: DemoResult): string {
  const reasons = result.confidenceReasons.join("；");
  if (/没有解析出公司名/.test(reasons)) return "没认出是哪家公司。";
  if (/不是一件流程事件|与求职无关/.test(reasons)) return "这封信可能和你的求职流程无关。";
  if (/两边不一致/.test(reasons)) return "规则和模型对「这是什么事」看法不同。";
  if (/未到的场次/.test(reasons)) return "信里有不止一个时间，不确定哪个才是正事。";
  if (/时区未知/.test(result.dueReason)) return "信里写了时间，但没说是哪个时区的。";
  if (/没有解析出任何时间/.test(reasons)) return "这类事通常有时间，但信里没读到。";
  if (/歧义/.test(result.dueReason)) return "日期的写法有两种读法（日/月顺序）。";
  if (/来自模型建议/.test(reasons)) return "规则没认出这是什么事，类型是模型建议的。";
  if (/时间语义置信度/.test(reasons)) return "时间读得不够有把握。";
  return "有关键信息拿不准，详情里有具体原因。";
}

/**
 * 一件事可能来自几封邮件（通知 + 催办），链接和凭据取并集：
 * 催办信里常常不再重复密钥，只看其中一封会漏。按出现顺序去重。
 */
export function collectAccess(results: readonly (DemoResult | undefined)[]): {
  links: string[];
  credentials: Credential[];
} {
  const links: string[] = [];
  const credentials: Credential[] = [];
  for (const result of results) {
    if (!result) continue;
    for (const link of result.links) if (!links.includes(link)) links.push(link);
    for (const credential of result.credentials) {
      if (!credentials.some((c) => c.value === credential.value)) credentials.push(credential);
    }
  }
  return { links, credentials };
}

export interface DemoOptions {
  /** 观察者时区，用于双时区显示。 */
  viewerTimeZone: string;
  /** 默认用标题正则的桩抽取器。接入真实模型后从这里换。 */
  extractor?: LLMExtractor;
}

export async function runDemoParse(raw: RawEmail, options: DemoOptions): Promise<DemoResult> {
  const outcome = await parseEmail(raw, { extractor: options.extractor ?? new StubExtractor() });

  if (outcome.kind === "dropped") {
    return {
      destination: "dropped",
      company: "",
      displayCompany: "",
      role: null,
      eventType: null,
      format: null,
      kindLabel: "",
      dueType: null,
      dueReason: "",
      when: null,
      timeZone: null,
      confidence: null,
      confidenceReasons: [],
      dedupKey: null,
      extraction: null,
      links: [],
      credentials: [],
      trace: [{ label: "第一道筛选", value: "忽略", reason: outcome.reason }],
    };
  }

  const { event, trace } = outcome;
  const routing = route(event.confidence, event.eventType, trace.confidenceReasons);
  const kindLabel = kindLabelOf(event.eventType, trace.format.format);
  const displayCompany = trace.extraction.companyRaw ?? event.company;

  const steps: TraceStep[] = [
    { label: "第一道筛选", value: "是求职邮件", reason: trace.prefilter.reason },
    {
      label: "公司",
      value: displayCompany.length > 0 ? displayCompany : "没有认出",
      reason: event.companyMatched ? "命中公司别名表" : "未命中别名表，按原文清洗后使用",
    },
    {
      label: "什么事",
      value: EVENT_LABEL[event.eventType],
      reason: trace.usedEventTypeHint
        ? "规则没有结论，采纳了模型的建议（因此降为低把握）"
        : trace.eventType.reason,
    },
    { label: "什么形式", value: kindLabel, reason: trace.format.reason },
    {
      label: "哪个时区",
      value: trace.tz.tz === null ? "不确定" : zoneLabel(trace.tz.tz),
      reason: `${TZ_SOURCE_LABEL[trace.tz.source] ?? trace.tz.source}：${trace.tz.reason}`,
    },
    { label: "时间性质", value: DUE_LABEL[event.dueType], reason: trace.due.reason },
  ];

  return {
    destination: routing.destination,
    company: event.company,
    displayCompany,
    role: displayRole(trace.extraction.roleRaw, displayCompany),
    eventType: event.eventType,
    format: trace.format.format,
    kindLabel,
    dueType: event.dueType,
    dueReason: trace.due.reason,
    when:
      event.startUtc === null
        ? null
        : describeWhen(event.startUtc, event.sourceTimeZone, options.viewerTimeZone),
    timeZone: event.sourceTimeZone,
    confidence: event.confidence,
    confidenceReasons: trace.confidenceReasons,
    dedupKey: dedupKeyOf(event),
    extraction: trace.extraction,
    links: trace.action.links,
    credentials: trace.action.credentials,
    trace: steps,
  };
}
