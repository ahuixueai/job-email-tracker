import {
  codeSender,
  devInsecure,
  effectiveForwarders,
  ensureOwner,
  inboxAddress,
  MAX_EXTRA_FORWARDERS,
  normalizeEmail,
  registrationOpen,
  requestCode,
  resetCalendarToken,
  setAiEnabled,
  setForwarders,
  turnstileChecker,
  userById,
  verifyCode,
} from "./accounts.js";
import type { SendCode, TurnstileCheck } from "./accounts.js";
import {
  CLEAR_SESSION_COOKIE,
  issueSession,
  MAX_FAILURES_PER_HOUR,
  passwordMatches,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  sessionUser,
  signingSecret,
} from "./auth.js";
import { parsePrefs } from "../../web/lib/demo/boardPrefs";
import { aiDailyLimit, aiUsageToday } from "./ai.js";
import { deleteUserSetting, getUserSetting, loadPrefs, putUserSetting } from "./store.js";
import { loadResume, prepare, resumeToStore } from "./prepare.js";
import { quickAdd } from "./quickAdd.js";
import { importEmail } from "./inbox.js";
import { reparseBatch, retryModelBatch } from "./reparse.js";
import { findProblems, sendAlert } from "./monitor.js";
import { DELETE_CONFIRM_TEXT, deleteUserData } from "./privacy.js";
import type { Env } from "./types.js";

/** 存手动操作的上限。正常用一年也到不了这个量级，超了多半是出错了。 */
const MAX_EDITS_BYTES = 512 * 1024;
/** 简历（文字）上限：2 万字的 JSON，留余量。 */
const MAX_RESUME_BYTES = 200 * 1024;
/** AI 面试准备的请求上限：最多 8 封信、总长 1.4 万字。 */
const MAX_PREPARE_BYTES = 200 * 1024;
/** 导入的单封邮件上限。正文入库前还会截到 2 万字。 */
const MAX_IMPORT_BYTES = 128 * 1024;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // 你的邮件不能被任何中间缓存留下来
      "cache-control": "no-store",
      ...headers,
    },
  });
}

const fail = (status: number, message: string) => json({ error: message }, status);

/**
 * 私人看板的读写接口。除了登录本身，每一个都要求已登录。
 *
 * - GET  /api/auth/config                 → 登录页要的：防机器人站点密钥、有没有备用密码
 * - POST /api/auth/code  {email, turnstile} → 发 6 位验证码（不管有没有这个账号，回答都一样）
 * - POST /api/auth/verify {email, code}    → 验证码对了就设置 cookie
 * - POST /api/login      {password, turnstile} → 备用：作者账号用密码登录
 * - POST /api/logout                      → 清掉 cookie
 * - POST /api/account/delete {confirm}    → 删除我的账号和全部数据（要手打「删除全部数据」），同时退出登录
 * - PUT  /api/account/forwarders {list}   → 除登录邮箱外，还允许哪些邮箱转信进来（最多 3 个）
 * - PUT  /api/account/ai {enabled}        → 用不用 AI（关掉只用规则）
 * - GET  /api/monitor · POST /api/monitor/test → 现在有没有问题 / 发一封测试提醒（只有作者账号）
 * - GET  /api/session                     → 登录的是谁、收信地址、允许转信的邮箱、AI 开关与今天的用量
 * - GET  /api/calendar · POST /api/calendar/reset → 日历订阅链接 / 换一把新口令
 * - GET  /api/emails                      → 收到的邮件与解析结论（最新的在前）
 * - DELETE /api/emails/:id               → 彻底删除一封信（必须先在看板上删进回收站）
 * - GET  /api/notices                     → Gmail 转发验证信等提醒
 * - DELETE /api/notices/:id              → 转发确认做完了，删掉这条提醒
 * - GET  /api/edits / PUT /api/edits      → 你在看板上的手动操作
 * - GET/PUT /api/prefs                  → 看板偏好（日历提醒提前量…），和「你的修改」分开存
 * - GET/PUT/DELETE /api/resume          → 你的简历（只存文字）
 * - POST /api/prepare   {company,…,emails} → AI 面试准备：来信 + 简历 → 准备要点（不落库）
 * - POST /api/quick-add {text}            → 一句话添加：模型认出的公司、岗位、类型建议（时间由浏览器里的规则算）
 * - POST /api/reparse    {after}           → 按现在的规则重判已存的邮件（一批 10 封；改求职地后看板自己调）
 * - POST /api/reparse    {after, retryModel: true} → 收信时模型没响应的信，重新调用模型摘一遍（一批 3 封）
 * - POST /api/import     {from, subject, body, receivedAtUtc} → 导入一封旧邮件（scripts/import-gmail.mjs 用）
 */
/** 测试里替换掉的外部依赖：Turnstile 校验、发验证码。生产用默认的。 */
export interface ApiDeps {
  checkTurnstile?: TurnstileCheck;
  sendCode?: SendCode | null;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function handleApi(request: Request, env: Env, nowMs: number, deps: ApiDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const secret = signingSecret(env);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const insecure = devInsecure(env);
  const passedTurnstile = async (token: unknown) => insecure || (await (deps.checkTurnstile ?? turnstileChecker(env))(token, ip));
  const lockedOut = async () => {
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
      .bind(ip, new Date(nowMs - 3_600_000).toISOString())
      .first<{ n: number }>();
    return (recent?.n ?? 0) >= MAX_FAILURES_PER_HOUR;
  };
  const recordFailure = () => env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, new Date(nowMs).toISOString()).run();
  const signIn = async (userId: string) => {
    const session = await issueSession(secret, userId, nowMs);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(session.value, session.maxAge) });
  };

  // 登录页要知道：防机器人的站点密钥、有没有备用密码
  if (path === "/api/auth/config" && request.method === "GET") {
    return json({
      turnstileSiteKey: insecure ? null : (env.TURNSTILE_SITE_KEY ?? null),
      passwordLogin: (env.BOARD_PASSWORD ?? "").length > 0,
      registration: registrationOpen(env),
      devMode: insecure,
    });
  }

  // 第 1 步：要验证码
  if (path === "/api/auth/code" && request.method === "POST") {
    if (secret.length === 0) return fail(503, "还没有设置登录钥匙：先运行 npx wrangler secret put SESSION_SECRET");
    if (!insecure && !env.TURNSTILE_SECRET) return fail(503, "防机器人验证还没配置好，暂时只能用密码登录");
    const sender = deps.sendCode !== undefined ? deps.sendCode : codeSender(env);
    if (!insecure && !sender) return fail(503, "发信还没配置好，暂时只能用密码登录");
    const body = await readJson(request);
    const email = normalizeEmail(body?.email);
    if (email === null) return fail(400, "邮箱格式不对");
    if (!(await passedTurnstile(body?.turnstile))) return fail(403, "没通过人机验证，请再试一次");
    await ensureOwner(env, nowMs);
    try {
      const result = await requestCode(env, email, ip, nowMs, sender, insecure);
      if (result.kind === "cooldown") return json({ error: `请 ${result.retryAfterSec} 秒后再发`, retryAfter: result.retryAfterSec }, 429);
      if (result.kind === "too_many") return fail(429, "发得太频繁了，请一小时后再试");
      if (result.kind === "full") return fail(403, "内测名额已满，暂时不能注册新账号");
      return json({ ok: true, ...(result.devCode ? { devCode: result.devCode } : {}) });
    } catch (error) {
      console.log(JSON.stringify({ loginCodeSendFailed: error instanceof Error ? (error as Error & { code?: string }).code ?? error.message : "unknown" }));
      return fail(502, "验证码没发出去，请稍后再试，或用密码登录");
    }
  }

  // 第 2 步：填验证码
  if (path === "/api/auth/verify" && request.method === "POST") {
    if (await lockedOut()) return fail(429, "失败次数太多，请一小时后再试");
    const body = await readJson(request);
    const email = normalizeEmail(body?.email);
    if (email === null) return fail(400, "邮箱格式不对");
    const result = await verifyCode(env, email, body?.code, nowMs);
    if (result.kind === "ok") return signIn(result.user.id);
    await recordFailure();
    if (result.kind === "wrong") return fail(401, `验证码不对，还能试 ${result.attemptsLeft} 次`);
    return fail(401, "验证码已失效，请重新获取");
  }

  // 备用：作者账号的密码
  if (path === "/api/login" && request.method === "POST") {
    if ((env.BOARD_PASSWORD ?? "").length === 0) return fail(503, "还没有设置看板密码：先运行 npx wrangler secret put BOARD_PASSWORD");
    if (await lockedOut()) return fail(429, "失败次数太多，请一小时后再试");
    const body = await readJson(request);
    if (body === null) return fail(400, "请求格式不对");
    // 防机器人配好了就要过；还没配好时只靠上面的失败次数限制（不至于把作者自己锁在外面）
    if ((env.TURNSTILE_SECRET || deps.checkTurnstile) && !(await passedTurnstile(body.turnstile))) return fail(403, "没通过人机验证，请再试一次");
    const password = typeof body.password === "string" ? body.password : "";
    if (!(await passwordMatches(password, env.BOARD_PASSWORD ?? ""))) {
      await recordFailure();
      return fail(401, "密码不对");
    }
    const owner = await ensureOwner(env, nowMs);
    if (owner === null) return fail(503, "还没有设置作者邮箱（wrangler.toml 里的 OWNER_EMAIL）");
    return signIn(owner.id);
  }

  if (path === "/api/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": CLEAR_SESSION_COOKIE });
  }

  const userId = await sessionUser(readCookie(request.headers.get("cookie"), SESSION_COOKIE), secret, nowMs);
  const user = userId === null ? null : await userById(env, userId);
  if (user === null) return fail(401, "请先登录");

  // 登录的是谁、收信地址、只收哪些邮箱转来的信、AI 开关与今天的用量（教程和设置页要用）
  if (path === "/api/session" && request.method === "GET") {
    return json({
      ok: true,
      user: { email: user.email, role: user.role },
      inbox: inboxAddress(env, user),
      forwarders: effectiveForwarders(env, user),
      extraForwarders: user.forwarders.split(",").filter((s) => s.includes("@")),
      maxExtraForwarders: MAX_EXTRA_FORWARDERS,
      ai: { enabled: user.ai_enabled !== 0, usedToday: await aiUsageToday(env, user.id, nowMs), dailyLimit: user.role === "owner" ? null : aiDailyLimit(env) },
    });
  }

  // 除登录邮箱外，还允许哪些邮箱转信进来（比如登录用的是学校邮箱，转信用的是 Gmail）
  if (path === "/api/account/forwarders" && request.method === "PUT") {
    const body = (await request.json().catch(() => ({}))) as { list?: unknown };
    const result = await setForwarders(env, user.id, body.list);
    return typeof result === "string" ? fail(400, result) : json({ ok: true, extraForwarders: result });
  }

  // AI 开关：关掉之后新来的信只用规则解析，一句话添加和面试准备也不可用
  if (path === "/api/account/ai" && request.method === "PUT") {
    const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") return fail(400, "格式不对");
    await setAiEnabled(env, user.id, body.enabled);
    return json({ ok: true, enabled: body.enabled });
  }

  // 删除我的账号和全部数据：立即生效，顺带退出登录。要手打确认语，防手滑、防被诱导点一下就删
  if (path === "/api/account/delete" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
    if (body.confirm !== DELETE_CONFIRM_TEXT) return fail(400, `请输入「${DELETE_CONFIRM_TEXT}」确认`);
    await deleteUserData(env, user);
    return json({ ok: true }, 200, { "set-cookie": CLEAR_SESSION_COOKIE });
  }

  // 收信监控是系统级的（所有人的收信情况），只给作者看
  if (path.startsWith("/api/monitor") && user.role !== "owner") return fail(403, "只有作者账号能看");

  // 收信监控：现在有没有问题（设置页显示）；发一封测试提醒，确认提醒真的能收到
  if (path === "/api/monitor" && request.method === "GET") {
    return json({ problems: await findProblems(env, nowMs), alertTo: env.OWNER_EMAIL ?? null });
  }
  if (path === "/api/monitor/test" && request.method === "POST") {
    try {
      const sent = await sendAlert(env, "准点提醒：测试", ["这是一封测试提醒。收到它，说明出问题时你能收到看板的自动提醒。"]);
      return sent ? json({ ok: true }) : fail(503, "还没配置发信（EMAIL）或登录邮箱（OWNER_EMAIL）");
    } catch {
      return fail(502, "发信失败：确认这个邮箱已在 Cloudflare Email Routing 里验证过");
    }
  }

  // 日历订阅链接：每人一把口令，和登录无关；泄露了就换一把
  if (path === "/api/calendar" && request.method === "GET") {
    const token = user.calendar_token ?? (await resetCalendarToken(env, user.id));
    return json({ url: `${url.origin}/cal/${token}.ics` });
  }
  if (path === "/api/calendar/reset" && request.method === "POST") {
    return json({ url: `${url.origin}/cal/${await resetCalendarToken(env, user.id)}.ics` });
  }

  if (path === "/api/emails" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error FROM emails WHERE user_id = ? ORDER BY received_at DESC LIMIT 1000",
    )
      .bind(user.id)
      .all();
    return json({ emails: rows.results });
  }

  const purge = /^\/api\/emails\/([^/]+)$/.exec(path);
  if (purge && request.method === "DELETE") {
    const id = decodeURIComponent(purge[1] ?? "");
    // 只删回收站里的：防止一个错误的请求直接删掉还在用的信
    const edits = await getUserSetting(env, user.id, "edits");
    let trashed = false;
    try {
      const deleted = edits !== null ? (JSON.parse(edits) as { deletedEmails?: Record<string, unknown> }).deletedEmails : undefined;
      trashed = typeof deleted === "object" && deleted !== null && id in deleted;
    } catch {
      trashed = false;
    }
    if (!trashed) return fail(409, "这封信不在回收站里：先在看板上删除，再彻底删除");
    await env.DB.prepare("DELETE FROM emails WHERE id = ? AND user_id = ?").bind(id, user.id).run();
    return json({ ok: true });
  }

  // 转发确认做完了：这条提醒删掉，不再显示（只删自己的）
  const notice = /^\/api\/notices\/([^/]+)$/.exec(path);
  if (notice && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM notices WHERE id = ? AND user_id = ?").bind(decodeURIComponent(notice[1] ?? ""), user.id).run();
    return json({ ok: true });
  }

  if (path === "/api/notices" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, kind, received_at, subject, body FROM notices WHERE user_id = ? ORDER BY received_at DESC LIMIT 5")
      .bind(user.id)
      .all();
    return json({ notices: rows.results });
  }

  if (path === "/api/edits" && request.method === "GET") {
    const edits = await getUserSetting(env, user.id, "edits");
    return json({ edits: edits !== null ? JSON.parse(edits) : null });
  }

  if (path === "/api/edits" && request.method === "PUT") {
    const text = await request.text();
    if (text.length > MAX_EDITS_BYTES) return fail(413, "手动操作的数据太大了");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return fail(400, "不是合法的 JSON");
    }
    if (typeof parsed !== "object" || parsed === null || (parsed as { version?: unknown }).version !== 1) {
      return fail(400, "数据形状不对");
    }
    await putUserSetting(env, user.id, "edits", text, new Date(nowMs).toISOString());
    return json({ ok: true });
  }

  if (path === "/api/prefs" && request.method === "GET") {
    return json({ prefs: await loadPrefs(env, user.id) });
  }

  if (path === "/api/prefs" && request.method === "PUT") {
    const text = await request.text();
    if (text.length > 4096) return fail(413, "偏好设置太大了");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return fail(400, "不是合法的 JSON");
    }
    // 只存认得的字段、认得的取值：存进去的永远是一份合法的偏好；没给或乱给的字段保持现在的值
    const prefs = parsePrefs(parsed, await loadPrefs(env, user.id));
    await putUserSetting(env, user.id, "prefs", JSON.stringify(prefs), new Date(nowMs).toISOString());
    return json({ prefs });
  }

  if (path === "/api/resume" && request.method === "GET") {
    const resume = await loadResume(env, user.id);
    return json({ resume });
  }

  if (path === "/api/resume" && request.method === "PUT") {
    const text = await request.text();
    if (text.length > MAX_RESUME_BYTES) return fail(413, "简历太大了");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return fail(400, "不是合法的 JSON");
    }
    const resume = resumeToStore(parsed, nowMs);
    if (typeof resume === "string") return fail(400, resume);
    await putUserSetting(env, user.id, "resume", JSON.stringify(resume), resume.updatedAt);
    return json({ resume });
  }

  if (path === "/api/resume" && request.method === "DELETE") {
    await deleteUserSetting(env, user.id, "resume");
    return json({ ok: true });
  }

  if (path === "/api/prepare" && request.method === "POST") {
    const text = await request.text();
    if (text.length > MAX_PREPARE_BYTES) return fail(413, "发来的信太多了");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return fail(400, "不是合法的 JSON");
    }
    const result = await prepare(env, user, nowMs, parsed);
    return result.ok ? json({ prep: result.prep, usedResume: result.usedResume }) : fail(result.status, result.error);
  }

  if (path === "/api/quick-add" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { text?: unknown };
    const result = await quickAdd(env, user, nowMs, body.text);
    return result.ok ? json({ model: result.model, warning: result.warning ?? null }) : fail(result.status, result.error);
  }

  if (path === "/api/reparse" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { after?: unknown; retryModel?: unknown };
    const after = typeof body.after === "string" && body.after.length > 0 ? body.after : null;
    // retryModel：只重做收信时模型没响应的那几封，这次真的调用模型
    return json(body.retryModel === true ? await retryModelBatch(env, user, after, nowMs) : await reparseBatch(env, user.id, after));
  }

  if (path === "/api/import" && request.method === "POST") {
    const text = await request.text();
    if (text.length > MAX_IMPORT_BYTES) return fail(413, "单封邮件太大了");
    let item: Record<string, unknown>;
    try {
      item = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return fail(400, "不是合法的 JSON");
    }
    const str = (key: string) => (typeof item[key] === "string" ? (item[key] as string) : "");
    const result = await importEmail(
      { from: str("from"), subject: str("subject"), body: str("body"), receivedAtUtc: str("receivedAtUtc") },
      env,
      user,
      nowMs,
      () => crypto.randomUUID(),
    );
    if (result.kind === "invalid") return fail(400, result.reason);
    return json(result);
  }

  return fail(404, "没有这个接口");
}
