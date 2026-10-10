/**
 * 发件域名的地域知识。company.ts 与 timezone.ts 共用这一份，避免两处名单漂移。
 *
 * 关键区分：ATS 域名对「是哪家公司」一律无效（背后是任意多家客户），
 * 但对「在哪个时区」不一定无效——国内 ATS 的客户绝大多数是国内企业，
 * 而 Greenhouse / Workday 这类国际 ATS 的客户遍布全球，不含任何地域信息。
 */

/** 国内 ATS：客户绝大多数是国内企业，可作为时区的中等强度线索。 */
export const DOMESTIC_ATS_DOMAINS: readonly string[] = [
  "mokahr.com",
  "ibeisen.com",
  "nowcoder.net",
  "hire.feishu.cn",
  "feishu.cn",
  "zhaopin.com",
  "liepin.com",
  "51job.com",
  "dajie.com",
];

/**
 * 国际 ATS：客户遍布全球，**不得**据此推断任何地域。
 * 不能因为 Greenhouse 是美国公司的产品就推出美东时区。
 */
export const INTERNATIONAL_ATS_DOMAINS: readonly string[] = [
  "greenhouse.io",
  "lever.co",
  "myworkday.com",
  "workday.com",
  "icims.com",
  "taleo.net",
  "smartrecruiters.com",
  "ashbyhq.com",
  "jobvite.com",
  "successfactors.com",
];

/**
 * 归属地不明的 ATS。算 ATS（不用于推断公司），但也不用于推断时区。
 * 宁可少一条线索，也不要给出一个说不出依据的时区。
 */
export const UNKNOWN_REGION_ATS_DOMAINS: readonly string[] = [
  "joinus.cc",
  "hrtps.com",
];

export const ATS_DOMAINS: readonly string[] = [
  ...DOMESTIC_ATS_DOMAINS,
  ...INTERNATIONAL_ATS_DOMAINS,
  ...UNKNOWN_REGION_ATS_DOMAINS,
];

/**
 * 企业自有域名 → 所在地区（交给 regionToTimeZone 解析）。
 *
 * 只收地域明确的。apple.com / kpmg.com / pwc.com 这类全球总部域名不收——
 * 它们同时给各国分部发信，据此推断会系统性出错。
 */
export const COMPANY_DOMAIN_REGIONS: ReadonlyArray<readonly [string, string]> = [
  ["jd.com", "国内"],
  ["oppo.com", "国内"],
  ["haier.net", "国内"],
  ["alibaba-inc.com", "国内"],
  ["xiaomi.com", "国内"],
  ["pinduoduo.com", "国内"],
  ["didiglobal.com", "国内"],
  ["anta.com", "国内"],
  ["picc.com.cn", "国内"],
  ["bytedance.com", "国内"],
  ["tencent.com", "国内"],
  ["meituan.com", "国内"],
  ["baidu.com", "国内"],
];

/** 从邮件地址或裸域名里取域名部分。 */
export function extractDomain(senderDomain: string): string {
  const at = senderDomain.lastIndexOf("@");
  const domain = at >= 0 ? senderDomain.slice(at + 1) : senderDomain;
  return domain.trim().toLowerCase().replace(/[<>\s]/g, "");
}

/** 域名是否命中名单里的某一项（含子域）。 */
export function matchesDomain(domain: string, list: readonly string[]): boolean {
  return list.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

/** 顶级域，如 "kpmg.com.cn" → "cn"。 */
export function topLevelDomain(domain: string): string {
  const parts = domain.split(".");
  return parts[parts.length - 1] ?? "";
}
