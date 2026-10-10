// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
import { SEED_ALIASES } from "./companyAliasSeed";
import { ATS_DOMAINS, extractDomain, matchesDomain } from "./domains";

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

function canonicalFromDomain(senderDomain: string): string | null {
  const domain = extractDomain(senderDomain);
  if (domain.length === 0 || isAtsDomain(domain)) return null;
  for (const [hint, canonical] of DOMAIN_HINTS) {
    if (domain === hint || domain.endsWith(`.${hint}`)) return canonical;
  }
  return null;
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
  const exact = AMBIGUOUS_EXACT.get(lightKey(raw ?? ""));
  if (exact) return { canonical: exact, matched: true };

  const cleaned = cleanCompanyName(raw ?? "");

  if (cleaned.length > 0) {
    const hit = ALIAS_INDEX.get(matchKey(cleaned));
    if (hit) return { canonical: hit, matched: true };
  }

  if (senderDomain) {
    const byDomain = canonicalFromDomain(senderDomain);
    if (byDomain) return { canonical: byDomain, matched: true };
  }

  return { canonical: cleaned, matched: false };
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
