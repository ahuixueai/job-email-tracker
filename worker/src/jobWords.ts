/**
 * 挑招聘信用的词表：收信时「像不像招聘信」和看板上各家邮箱的设置教程共用这一份。改词表只改这里。
 *
 * 10/16 用作者 264 封真实招聘信算过：只看标题 7 个词只接住 46%；下面这套规则用的词表
 * （标题 15 词 + 发件人 10 个招聘系统）只看标题和发件人约 94%（推算）。漏掉的主要是推广和对方的自动答复。
 */

/** 用户在邮箱里设规则（QQ / Outlook / 其他）：标题包含这些词就转。词要一个个加，所以不能太多。 */
export const SUBJECT_KEYWORDS = [
  "面试", "笔试", "测评", "Offer", "申请", "interview", "application", "投递", "应聘", "网申", "校招", "招聘", "宣讲", "assessment", "applying",
] as const;

/** 规则里的正文一行：只放最有区分度的几个，「申请」「application」放正文太泛（信用卡、银行的信也有）。 */
export const BODY_KEYWORDS = ["面试", "笔试", "测评", "网申", "interview", "assessment"] as const;

/** 规则里的发件人一行：招聘系统。「zhaopin」「icims」不带后缀：智联有 .cn / .com，iCIMS 有 .com / .eu。 */
export const SENDER_DOMAINS = [
  "mokahr.com", "hotjob.cn", "beisen.com", "italent.cn", "feishu.cn", "zhaopin", "51job.com", "nowcoder.com", "myworkday.com", "icims",
] as const;

/** 宽词表：Gmail 过滤器（一整段粘贴，不怕长），以及「全部转发」时准点自己挑信。 */
export const WIDE_KEYWORDS = [
  "面试", "笔试", "测评", "网申", "校招", "招聘", "录用", "Offer", "实习", "宣讲", "简历", "投递", "应聘",
  "一面", "二面", "三面", "终面", "群面", "复试",
  "interview", "assessment", "application", "applying", "candidate", "HireVue",
] as const;

export const WIDE_SENDER_DOMAINS = [
  "mokahr.com", "hotjob.cn", "beisen.com", "ibeisen.com", "italent.cn", "feishu.cn", "nowcoder.com", "zhaopin.com", "zhaopin.cn", "51job.com", "liepin.com",
  "zhipin.com", "shixiseng.com", "hirevue.com", "myworkday.com", "greenhouse.io", "lever.co", "successfactors.com", "smartrecruiters.com", "icims.com", "icims.eu", "avature.net",
] as const;

/**
 * 「全部转发」过来的信像不像招聘信：标题或正文带宽词表里的词，或者从招聘系统发来。
 * 不像的直接丢掉：不存、不交给 AI、不扣额度（私人邮件不留在准点）。
 * 宁可多收：广告收进来也会被认成广告收进「已忽略」，漏掉一封招聘信的代价大得多。
 * 用的是所有词表的并集：用户在邮箱里设的规则（含「申请」）挑出来转过来的信，这里一定也放行，不会二次误丢。
 */
const FILTER_WORDS = [...new Set([...WIDE_KEYWORDS, ...SUBJECT_KEYWORDS, ...BODY_KEYWORDS].map((w) => w.toLowerCase()))];
const FILTER_DOMAINS = [...new Set([...WIDE_SENDER_DOMAINS, ...SENDER_DOMAINS])];

export function looksLikeJobMail(mail: { from: string; subject: string; body: string }): boolean {
  const text = `${mail.subject}\n${mail.body}`.toLowerCase();
  if (FILTER_WORDS.some((word) => text.includes(word))) return true;
  const from = mail.from.toLowerCase();
  return FILTER_DOMAINS.some((domain) => from.includes(domain));
}
