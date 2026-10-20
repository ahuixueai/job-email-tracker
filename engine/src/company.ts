import { SEED_ALIASES } from "./companyAliasSeed.js";
import { ATS_DOMAINS, extractDomain, matchesDomain } from "./domains.js";

/**
 * 公司名归一化。
 *
 * baseline 报告第 3 节：「KPMG」和「毕马威 (KPMG)」被当成两家公司，
 * 同一条求职线在看板上被劈成两半。
 *
 * 国内公司的中英文对应关系没有现成数据源，这张表本身就是护城河的一部分
 * （方案 v0.2 第 6.3 节）。所以宁可表短一点、准一点，也不做模糊猜测。
 */

export interface NormalizedCompany {
  /** 归一后的公司名。命中别名表则是标准名，否则是清洗过的原名。 */
  canonical: string;
  /** 是否命中别名表。false 时不要拿它做跨记录合并的强依据。 */
  matched: boolean;
}

/** 标准名 → 全部别名（含中文名、英文名、缩写）。比对时统一小写。 */
const ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["毕马威", ["毕马威", "kpmg", "毕马威华振", "毕马威企业咨询"]],
  ["Apple", ["apple", "苹果", "apple苹果", "苹果公司", "apple inc"]],
  ["普华永道", ["普华永道", "pwc", "pricewaterhousecoopers", "普华永道中天"]],
  ["拼多多", ["拼多多", "pdd", "pinduoduo", "temu"]],
  ["海尔", ["海尔", "haier", "海尔智家"]],
  ["中国人保", ["中国人保", "人保", "picc", "中国人民保险", "人保健康"]],
  ["京东", ["京东", "jd", "jingdong", "jd.com", "京东物流", "京东零售"]],
  ["小米", ["小米", "xiaomi", "mi", "小米科技"]],
  ["岚图", ["岚图", "voyah", "岚图汽车科技"]],
  ["安踏", ["安踏", "anta"]],
  ["阿里巴巴", ["阿里巴巴", "alibaba", "阿里", "ali", "淘天"]],
  ["OPPO", ["oppo", "欧珀", "广东欧珀"]],
  ["滴滴", ["滴滴", "didi", "didiglobal", "滴滴出行"]],
  // 种子表里只有「大疆创新 / DJI」，单说「大疆」认不出（「创新」不是通用后缀）
  ["大疆创新", ["大疆创新", "大疆", "dji"]],
];

/**
 * 公司自有域名 → 标准名。
 *
 * 只收企业自建域名。ATS 服务商的域名绝不能进这张表——
 * mail.joinus.cc 同时给毕马威和别家发信，把它映射成某一家会造成系统性错归。
 */
const DOMAIN_HINTS: ReadonlyArray<readonly [string, string]> = [
  ["jd.com", "京东"],
  ["oppo.com", "OPPO"],
  ["haier.net", "海尔"],
  ["alibaba-inc.com", "阿里巴巴"],
  ["apple.com", "Apple"],
  ["email.apple.com", "Apple"],
  ["xiaomi.com", "小米"],
  ["pwc.com", "普华永道"],
  ["kpmg.com", "毕马威"],
  ["pinduoduo.com", "拼多多"],
  ["didiglobal.com", "滴滴"],
  ["anta.com", "安踏"],
  ["picc.com.cn", "中国人保"],
];

/**
 * ATS / 邮件服务商域名的清单已挪到 domains.ts，与 timezone.ts 共用一份来源——
 * 命中这里就不拿域名当公司线索，这是防错归的关键：这些域名背后是任意多家公司。
 */

/** 公司名里没有区分度的后缀，去掉后再比对。长的排前面，避免短的先吃掉。 */
const SUFFIXES: readonly string[] = [
  "股份有限公司",
  "有限责任公司",
  "有限公司",
  "科技股份有限公司",
  "集团股份有限公司",
  "集团有限公司",
  "股份公司",
  "控股集团",
  // 地区后缀：「德勤中国」「百威中国」和「德勤」「百威」是同一家。种子表里的「X中国」别名也是这个意思。
  // 不收英文的 china：「Yum China」剥成「Yum」会撞上百胜全球（见 NEVER_RESOLVE）
  "中国区",
  "中国",
  "集团",
  "公司",
  "股份",
  "有限",
  "科技",
  "招聘",
  "校园招聘",
  "校招",
  "inc.",
  "inc",
  "ltd.",
  "ltd",
  "llc",
  "co.",
  "corporation",
  "corp.",
  "corp",
  "group",
];

/**
 * 清洗：去括号内容 → 去首尾杂符 → 去后缀 → 合并空白。
 * 括号里通常是另一种写法（「毕马威 (KPMG)」），去掉后剩下的才是主名。
 */
export function cleanCompanyName(raw: string): string {
  let out = raw.trim();
  // 全角与半角括号都要处理，中文邮件里两种混用很常见
  out = out.replace(/[（(【[][^）)】\]]*[）)】\]]/g, " ");
  out = out.replace(/[【】[\]（）()]/g, " ");
  out = out.replace(/\s+/g, " ").trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      const lower = out.toLowerCase();
      if (lower.endsWith(suffix) && out.length > suffix.length) {
        out = out.slice(0, out.length - suffix.length).trim();
        changed = true;
        break;
      }
    }
  }
  return out.replace(/[\s·、,，-]+$/, "").trim();
}

/**
 * 比对键：清洗后小写、去掉所有空白与常见分隔符、去掉变音符。
 *
 * normalize("NFD") 把「é」拆成「e」+ 一个独立的组合重音符（U+0300–U+036F），
 * 再把那段组合符删掉——「L'Oréal」「L'Oreal」「LOreal」由此收敛到同一个键。
 * 撇号与连字符本身也在去除之列，否则「L'Oréal」和「LOreal」的撇号差异会
 * 让它们看起来是两个不同的键。
 */
function matchKey(value: string): string {
  const withoutAccents = cleanCompanyName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return withoutAccents.toLowerCase().replace(/[\s·、.,，_'\u2019-]/g, "");
}

/**
 * 轻量键：只做括号剥离、大小写、变音符归一，**不做**通用后缀剥离。
 *
 * matchKey 会把「平安科技」和「平安」剥成同一个键——两个不同长度的输入
 * 变得无法区分，没有办法只放行前者、拒绝后者。lightKey 保留「科技」，
 * 专门用来精确识别 AMBIGUOUS_EXACT 这几个必须原样匹配的全名。
 */
function lightKey(value: string): string {
  let out = value.trim();
  out = out.replace(/[（(【[][^）)】\]]*[）)】\]]/g, " ");
  out = out.replace(/[【】[\]（）()]/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  return out
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s·、.,，_'\u2019-]/g, "");
}

/**
 * 需要原样精确识别的全名：常规 matchKey 会把它们剥成 NEVER_RESOLVE 里
 * 那几个歧义短名（见下），导致「平安科技」这个合法全名也被一并挡在外面。
 * 这里单独走一条不剥后缀的精确匹配，在查主索引之前优先命中。
 */
const AMBIGUOUS_EXACT: ReadonlyMap<string, string> = new Map(
  ["平安科技", "百胜中国", "红杉中国"].map((full) => [lightKey(full), full] as const),
);

/** 合并时被现有条目挡下的种子条目，供人工复核。 */
export interface AliasConflict {
  seedCanonical: string;
  /** 撞上的键（清洗后的比对键）。 */
  collidingKey: string;
  /** 现有表里该键指向的标准名，冲突时以它为准。 */
  existingCanonical: string;
}

interface AliasIndexResult {
  index: ReadonlyMap<string, string>;
  conflicts: readonly AliasConflict[];
}

/**
 * 永不解析的键。
 *
 * 「平安科技」经过 matchKey 的通用后缀剥离（SUFFIXES 里含「科技」）会
 * 自动收窄成「平安」——这条映射的产生**跟别名列表里写没写「平安」无关**，
 * 是 cleanCompanyName 对 canonical 自身做通用清洗时的副作用。
 * 「平安」单独出现时通常指平安集团这个母公司（旗下还有平安银行、
 * 平安证券等独立子品牌），不是特指平安科技这一个子公司；同理百胜
 * （Yum! Brands 全球 vs 百胜中国/Yum China，2016 分拆）、红杉
 * （Sequoia Capital 全球 vs 红杉中国/HongShan，2023 分拆）也是各自
 * 独立存在的主体，不能因为名字像就合并。
 *
 * 生成脚本已经把这三个短名从种子的别名列表里删掉了（见
 * tools/gen-alias-seed.mjs 的 ALIAS_DENYLIST），但那只堵住了「显式别名」
 * 这一条路，堵不住「canonical 自己被剥出同一个键」这条路。两条路都通向
 * 同一个错误结果，所以在索引建完之后统一兜底删除——不管上游数据怎么变，
 * 这三个键永远不解析到任何公司，宁可 matched:false 也不能错误合并。
 */
const NEVER_RESOLVE = ["平安", "百胜", "红杉"].map(matchKey);

/**
 * 建索引：手工表先入，再合并外部种子。
 *
 * 冲突消解规则——种子条目只要有任意一个键已经指向某个现有标准名，
 * 就把这条种子**整体折叠**进那个标准名，而不是新建一个。
 *
 * 为什么不是「跳过冲突键、保留其余」：那会把「苹果中国」注册成独立标准名，
 * 同一家公司在看板上又被劈成两半——正是 baseline 第 3 节要解决的问题。
 */
function buildAliasIndex(
  manual: ReadonlyArray<readonly [string, readonly string[]]>,
  seed: ReadonlyArray<readonly [string, readonly string[]]>,
): AliasIndexResult {
  const index = new Map<string, string>();
  for (const [canonical, aliases] of manual) {
    for (const alias of aliases) index.set(matchKey(alias), canonical);
    index.set(matchKey(canonical), canonical);
  }

  const conflicts: AliasConflict[] = [];
  for (const [canonical, aliases] of seed) {
    const keys = [canonical, ...aliases].map(matchKey).filter((k) => k.length > 0);
    const hit = keys.map((k) => index.get(k)).find((v) => v !== undefined);
    const target = hit ?? canonical;
    if (hit !== undefined && hit !== canonical) {
      conflicts.push({
        seedCanonical: canonical,
        collidingKey: keys.find((k) => index.get(k) === hit) ?? "",
        existingCanonical: hit,
      });
    }
    for (const key of keys) {
      // 已经指向别处的键不动：手工表与先到的种子条目优先
      if (!index.has(key)) index.set(key, target);
    }
  }

  // 兜底：无论上面两段数据把这几个键指向了谁，一律清空
  for (const key of NEVER_RESOLVE) index.delete(key);

  return { index, conflicts };
}

const { index: ALIAS_INDEX, conflicts: SEED_CONFLICTS } = buildAliasIndex(
  ALIASES,
  SEED_ALIASES,
);

/** 种子合并时被现有条目挡下的条目。用于向人汇报，不参与运行时逻辑。 */
export const ALIAS_SEED_CONFLICTS = SEED_CONFLICTS;

/** 别名索引的规模，便于验收时确认种子确实合进来了。 */
export const ALIAS_INDEX_SIZE = ALIAS_INDEX.size;

/** 域名是否属于 ATS 服务商（含子域）。判据与 timezone.ts 的 inferTimeZone 共用同一份名单。 */
export function isAtsDomain(senderDomain: string): boolean {
  return matchesDomain(extractDomain(senderDomain), ATS_DOMAINS);
}

/** 个人邮箱、招聘网站：域名本身说明不了是哪家公司。 */
const NOT_A_COMPANY_DOMAIN = /(?:^|\.)(?:gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|qq|foxmail|163|126|yeah|sina|sohu|139|aliyun|proton|protonmail|wisdomore|zhaopin|51job|lietou-edm|liepin|nowcoder|shixiseng|yingjiesheng|linkedin|indeed|glassdoor|zhipin)\.[a-z.]+$/;

/** 域名里不说明是哪家的那几段：顶级域、二级公共后缀。 */
const PUBLIC_SUFFIX_LABELS: ReadonlySet<string> = new Set(["com", "cn", "net", "org", "edu", "gov", "co", "io", "hk", "sg", "uk", "jp", "us", "tw", "mo", "de", "fr", "ai"]);

function canonicalFromDomain(senderDomain: string): string | null {
  const domain = extractDomain(senderDomain);
  if (domain.length === 0 || isAtsDomain(domain)) return null;
  for (const [hint, canonical] of DOMAIN_HINTS) {
    if (domain === hint || domain.endsWith(`.${hint}`)) return canonical;
  }
  // 域名主体本身就是别名表里的名字（dji.com → DJI → 大疆创新、deloitte.com.cn → 德勤）
  if (NOT_A_COMPANY_DOMAIN.test(domain)) return null;
  const labels = domain.split(".");
  while (labels.length > 1 && PUBLIC_SUFFIX_LABELS.has(labels[labels.length - 1]!)) labels.pop();
  const label = labels[labels.length - 1] ?? "";
  if (label.length < 2 || labels.length === domain.split(".").length) return null;
  return ALIAS_INDEX.get(matchKey(label)) ?? null;
}

/**
 * 归一化公司名。
 *
 * 顺序：精确名单（AMBIGUOUS_EXACT）→ 别名表 → 发件域名 → 放弃。
 * 精确名单必须排在最前面：它要在 matchKey 的通用后缀剥离生效之前，
 * 把「平安科技」这个合法全名拦下来——否则会先被剥成「平安」，
 * 撞上 NEVER_RESOLVE 的兜底删除，连它自己都认不出来。
 *
 * 匹配不上时返回清洗后的原名并置 matched=false，绝不瞎归并——
 * 错误合并两家公司比不合并糟糕得多，用户会看到别家的面试出现在自己的记录里。
 */
export function normalizeCompany(
  raw: string,
  senderDomain?: string,
): NormalizedCompany {
  const byName = matchName(raw ?? "");
  if (byName) return { canonical: byName, matched: true };

  if (senderDomain) {
    const byDomain = canonicalFromDomain(senderDomain);
    if (byDomain) return { canonical: byDomain, matched: true };
  }

  return { canonical: cleanCompanyName(raw ?? ""), matched: false };
}

/**
 * 只用名字查别名表（不看域名）。查不到返回 null。
 *
 * 中英混写拆开分别查：「DJI 大疆」「大疆DJI」「dji大疆」整体不在表里，
 * 但「DJI」「大疆」各自都指向大疆创新。拆出来的几段**必须指向同一家**才算数，
 * 指向两家（「京东 阿里」）就当没认出——错并两家比认不出糟。
 */
function matchName(raw: string): string | null {
  const exact = AMBIGUOUS_EXACT.get(lightKey(raw));
  if (exact) return exact;
  const cleaned = cleanCompanyName(raw);
  if (cleaned.length === 0) return null;
  const whole = ALIAS_INDEX.get(matchKey(cleaned));
  if (whole) return whole;

  // 只在中文与英文交界处拆；英文内部的空格不拆（「Loreal Group Holdings」不能拆出「Loreal」）
  const segments = (cleaned.match(/[\u3400-\u9fff]+|[A-Za-z0-9][A-Za-z0-9&.'\u2019\s-]*/g) ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
  if (segments.length < 2) return null;
  const hits = new Set<string>();
  for (const segment of segments) {
    const hit = AMBIGUOUS_EXACT.get(lightKey(segment)) ?? ALIAS_INDEX.get(matchKey(segment));
    if (hit) hits.add(hit);
  }
  return hits.size === 1 ? [...hits][0]! : null;
}

/**
 * 发件人显示名、标题里的套话。显示名常是「CN Deloitte Campus Recruitment Service」
 * 「DJI大疆校园招聘」这种：去掉套话剩下的才是公司名；剩不下东西就说明它不是公司名。
 * 招聘网站自己的名字（智联、猎聘…）也算套话：它们转发的是别家的岗位，不能当成公司。
 */
const GENERIC_WORDS: readonly string[] = [
  // 中文，长的在前
  "校园招聘", "社会招聘", "人力资源部", "人力资源", "招聘中心", "招聘团队", "招聘小组", "招聘通知", "招聘助手",
  "智联招聘", "智联推荐", "前程无忧", "猎聘网", "猎聘", "智联", "牛客网", "牛客", "实习僧", "应届生", "BOSS直聘",
  "秋季招聘", "春季招聘", "秋招", "春招", "校招", "招聘", "人才", "团队", "服务", "中心", "系统", "小助手", "助手",
  "官方", "通知", "提醒", "重要", "紧急", "邀请函", "邀请", "在线", "面试", "笔试", "测评", "推荐", "实习", "管培生",
];
const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  "hr", "recruitment", "recruiting", "recruiter", "recruit", "campus", "talent", "talents", "acquisition", "careers", "career",
  "service", "services", "team", "noreply", "no-reply", "donotreply", "notification", "notifications", "notice", "system",
  "official", "cn", "china", "university", "graduate", "graduates", "program", "programme", "jobs", "job", "hiring", "people",
  "linkedin", "moka", "beisen", "feishu", "workday", "greenhouse",
]);

/** 去掉套话之后剩下的部分；剩不下（或只剩一个字）返回空串。 */
export function stripGenericWords(value: string): string {
  let out = value.replace(/[|｜:：_·•\-–—/【】[\]（）()「」"“”]+/g, " ");
  // 届别、年份：「27届」「2027」「26/27」不是公司名的一部分
  out = out.replace(/(?:20)?\d{2}\s*届|20\d{2}\s*年?|\d{2}\s*\/\s*\d{2}/g, " ");
  for (const word of GENERIC_WORDS) out = out.split(word).join(" ");
  const tokens = out
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !GENERIC_TOKENS.has(t.toLowerCase()));
  const joined = tokens.join(" ").trim();
  return [...joined.replace(/\s+/g, "")].length >= 2 ? joined : "";
}

/** 一看就是机构名的字样。认不出的显示名要带着它们之一才当公司名用（人名不会带）。 */
const COMPANY_WORD =
  /(?:集团|公司|科技|银行|证券|基金|资本|控股|汽车|医疗|保险|咨询|事务所|研究院|研究所|电子|信息|网络|软件|智能|能源|材料|生物|医药|制药|传媒|文化|教育|地产|物流|航空|电气|通信|半导体|实业|股份|国际|机器人|互联网|游戏)/;

export interface CompanySignals {
  /** 模型摘的公司名。 */
  raw: string | null;
  senderDomain: string;
  /** 发件人显示名。 */
  senderName?: string;
  /** 标题里按固定格式取出的公司名（「【星河科技】…」「来自X的…」），没有为 null。 */
  subjectName?: string | null;
}

export type CompanySource = "model" | "domain" | "sender" | "subject" | "none";

/**
 * 公司从哪儿来，按把握从高到低：
 *
 * 1. 认得出的（命中别名表）：模型摘的名字 → 发件域名（含「dji.com」这种域名本身就是别名的）
 *    → 发件人显示名 → 标题格式。
 * 2. 都认不出时，退回原样显示：模型摘的 → 标题格式 → 显示名（**只在发件域名是招聘系统时**，
 *    因为北森、Moka 这类系统的显示名就是用人公司的名字；公司自己的域名发信时，显示名多半是「HR」）。
 *
 * 模型超时、没有模型时，后面几条就是公司名的唯一来源。
 */
export function resolveCompany(signals: CompanySignals): NormalizedCompany & { source: CompanySource } {
  const raw = signals.raw ?? "";
  const fromModel = normalizeCompany(raw, signals.senderDomain);
  if (fromModel.matched) {
    const byName = matchName(raw);
    return { ...fromModel, source: byName ? "model" : "domain" };
  }

  const sender = stripGenericWords(signals.senderName ?? "");
  const subject = stripGenericWords(signals.subjectName ?? "");
  const bySender = sender.length > 0 ? matchName(sender) : null;
  if (bySender) return { canonical: bySender, matched: true, source: "sender" };
  const bySubject = subject.length > 0 ? matchName(subject) : null;
  if (bySubject) return { canonical: bySubject, matched: true, source: "subject" };

  if (fromModel.canonical.length > 0) return { ...fromModel, source: "model" };
  if (subject.length > 0) return { canonical: cleanCompanyName(subject), matched: false, source: "subject" };
  // 北森这类系统的显示名常常是招聘专员本人（「张某某 <noreply@…ibeisen.com>」），
  // 所以认不出的显示名只有带着公司字样（集团、科技、银行…）才用
  if (sender.length > 0 && isAtsDomain(signals.senderDomain) && COMPANY_WORD.test(sender)) {
    return { canonical: cleanCompanyName(sender), matched: false, source: "sender" };
  }
  return { canonical: "", matched: false, source: "none" };
}

/** 两个写法是否指向同一家公司。只有双方都命中别名表才算数。 */
export function isSameCompany(
  a: string,
  b: string,
  aDomain?: string,
  bDomain?: string,
): boolean {
  const left = normalizeCompany(a, aDomain);
  const right = normalizeCompany(b, bDomain);
  if (!left.matched || !right.matched) return false;
  return left.canonical === right.canonical;
}
