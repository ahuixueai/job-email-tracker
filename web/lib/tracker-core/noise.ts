// 生成物：由 scripts/sync-tracker-core.mjs 从 tracker-core/src 同步而来，不要手改。
/**
 * 验证码 / 邮箱验证类噪音的**唯一**判定处。
 *
 * 原先这条正则在 prefilter.ts、eventType.ts、dueType.ts 各抄了一份，
 * 三处都是「全文任意位置出现『验证码』就算噪音」。真实邮件评测里它丢掉了
 * 一封测评邀请——那封信正文靠后有一句「短信验证码有效期为…」，
 * 说的是登录测评系统时要收验证码，信本身是货真价实的测评邀请。
 * 而预筛丢信是终局：不抽取、不入库、不进待确认，用户永远不知道它存在过。
 *
 * 所以判据从「出现过这个词」收紧成「这封信**就是**一封验证码邮件」：
 *
 *   1. 标题里出现            → 是。验证码邮件的标题形态高度固定
 *   2. 只在正文里出现        → 仅当全文没有任何流程环节词（测评/笔试/面试…）时才是。
 *                              一封信同时在谈测评和验证码，验证码只是登录步骤的说明
 *
 * 第 2 条放过去的最坏情况是一封「面试系统登录验证码」进了待确认收件箱，
 * 用户多看一眼；反方向的最坏情况是丢掉唯一一封测评邀请。两边代价不对等。
 */
const VERIFICATION =
  /验证码|一次性密码|one[-\s]?time\s+(?:pass)?(?:code|word)|verification\s+code|verify\s+your\b/i;

/** 流程环节词：出现任何一个，就说明这封信在谈一件真实的招聘环节。 */
const PROCESS_STEP =
  /测评|笔试|面试|\bassessment\b|\binterview\b|online\s+test|coding\s+(?:challenge|test)|phone\s+screen/i;

/**
 * @param subject 邮件标题。调用方手里只有一段不分标题正文的文本时传空串
 * @param body    正文（或那段不分标题正文的文本）
 */
export function isVerificationNoise(subject: string, body: string): boolean {
  if (VERIFICATION.test(subject ?? "")) return true;
  const text = body ?? "";
  if (!VERIFICATION.test(text)) return false;
  return !PROCESS_STEP.test(text) && !PROCESS_STEP.test(subject ?? "");
}
