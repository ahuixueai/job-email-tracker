import type { RawEmail } from "../tracker-core/index";

/**
 * 解析演示页用的**合成邮件**。
 *
 * ⚠️ 这里的公司、域名、岗位全部是虚构的，没有一封来自真实的招聘往来。
 * 公网演示站只能用这份数据——真实邮件只用于本机评测，永远不进这个文件。
 *
 * 每一封对应解析引擎要防的一类具体错误，而不是随手编的「看起来像」的邮件。
 * 日期都相对「现在」生成，这样演示站放多久打开，看到的都是「几天后」的安排，
 * 不会全部变成已过期。
 */

export interface SampleEmail {
  id: string;
  /** 列表里显示的短标题。 */
  title: string;
  /** 这一封在演示什么。 */
  teaches: string;
  raw: RawEmail;
  /**
   * 正文里随「现在」变化的日期片段，占位名 → 本次生成的实际文本。
   * 录制的模型抽取结果里存的是占位名（见 recorded.ts），回放时用这张表还原，
   * 否则隔天再打开，录制的「10月14日」就对不上当天生成的正文了。
   */
  tokens: Readonly<Record<string, string>>;
}

const DAY = 86_400_000;

function partsIn(ms: number, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  // en-CA 会把月、日补成两位。统一去掉前导零，要补零的地方由调用方自己补。
  out.month = String(Number(out.month));
  out.day = String(Number(out.day));
  return out;
}

/** 「10月20日」——中文邮件最常见的写法，不带年份。 */
export function cnMonthDay(ms: number, timeZone = "Asia/Shanghai"): string {
  const p = partsIn(ms, timeZone);
  return `${p.month}月${p.day}日`;
}

/** 「2026-10-20 09:05」——系统通知里常见的落款时刻。 */
export function isoMinute(ms: number, timeZone = "Asia/Shanghai"): string {
  const p = partsIn(ms, timeZone);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${(p.month ?? "").padStart(2, "0")}-${(p.day ?? "").padStart(2, "0")} ${hour}:${p.minute}`;
}

const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** 「20 October 2026」 */
export function enDate(ms: number, timeZone: string): string {
  const p = partsIn(ms, timeZone);
  return `${p.day} ${EN_MONTHS[Number(p.month) - 1]} ${p.year}`;
}

/** 「October 16, 2026」——美国邮件的写法，月在前。 */
export function usDate(ms: number, timeZone: string): string {
  const p = partsIn(ms, timeZone);
  return `${EN_MONTHS[Number(p.month) - 1]} ${p.day}, ${p.year}`;
}

export function buildSampleEmails(nowMs: number): SampleEmail[] {
  /**
   * @param daysAgo 这封信是几天前收到的。带相对期限或签发时刻的样本必须是 0（刚收到），
   *                否则「72 小时内」会从几天前起算，演示站一打开就全是过期的。
   */
  const email = (id: string, from: string, subject: string, body: string, daysAgo = 0): RawEmail => ({
    id,
    from,
    to: "demo@inbox.example",
    subject,
    body,
    receivedAtUtc: new Date(nowMs - daysAgo * DAY).toISOString(),
  });

  const examDay = cnMonthDay(nowMs + 5 * DAY);
  const issuedAt = isoMinute(nowMs);
  const hkDay = enDate(nowMs + 8 * DAY, "Asia/Hong_Kong");
  const plainDay = enDate(nowMs + 6 * DAY, "UTC");
  const phoneDay = cnMonthDay(nowMs + 3 * DAY);
  const aiDay = cnMonthDay(nowMs + 4 * DAY);
  const usDueDay = usDate(nowMs + 7 * DAY, "America/New_York");
  const usPhoneDay = usDate(nowMs + 5 * DAY, "America/Los_Angeles");
  const round2Day = cnMonthDay(nowMs + 6 * DAY);
  const finalDay = cnMonthDay(nowMs + 10 * DAY);

  /** 一封最普通的投递回执。 */
  const receipt = (id: string, company: string, domain: string, role: string, daysAgo: number): SampleEmail => ({
    id,
    title: `投递回执：${company}`,
    teaches: "过去几周收到的投递回执，用来让投递表和统计有一段真实长度的历史。",
    raw: email(
      id,
      `${company}招聘 <hr@${domain}.example>`,
      `【${company}】我们已收到你的申请`,
      ["你好，", "", `我们已收到你对 ${role} 的申请，招聘团队会尽快查看你的简历。`, "", `${company}招聘组`].join("\n"),
      daysAgo,
    ),
    tokens: {},
  });

  return [
    {
      id: "fixed-exam",
      title: "笔试通知：固定场次",
      teaches: "写明了开考时刻，迟到即失去资格。必须判成「固定场次」，不能当成截止期限。",
      raw: email(
        "fixed-exam",
        "星河科技校园招聘 <campus@xinghe-tech.example>",
        "星河科技 2027 校园招聘在线笔试通知",
        [
          "同学你好，",
          "",
          "感谢你投递星河科技商业分析师岗位。现邀请你参加在线笔试。",
          `考试时间：${examDay} 19:00-20:40（北京时间）`,
          "请提前 15 分钟登录调试设备，开考 15 分钟后不得入场。",
          "考试入口：https://exam.xinghe-tech.example/s/ba-kq7",
          "考试码：XHKJ-7Q4M",
          "",
          "星河科技校园招聘组",
        ].join("\n"),
      ),
      tokens: { EXAM_DAY: examDay },
    },
    {
      id: "relative-deadline",
      title: "测评邀请：72 小时内完成",
      teaches: "没有写具体日期，只有「收到后 72 小时内」。截止时刻要从收信那一刻起算。",
      raw: email(
        "relative-deadline",
        "北辰咨询招聘 <hr@beichen-consulting.example>",
        "【北辰咨询】在线测评邀请",
        [
          "你好，",
          "",
          "你已通过北辰咨询上海办公室咨询顾问岗位的简历筛选。",
          "请在收到本邮件后 72 小时内完成在线测评，逾期链接将自动失效。",
          "测评约 60 分钟，开始后不可暂停。",
          "测评链接：https://assess.beichen-consulting.example/a/7f3k2",
          "测评密钥：BC-7Q2M-91XK",
        ].join("\n"),
      ),
      tokens: {},
    },
    {
      id: "issuance-trap",
      title: "陷阱：邀请「生效时间」",
      teaches:
        "信里出现的唯一钟点是通知的生效时刻，不是考试时间。判成场次的话，界面会在收信当下就显示「已逾期」。",
      raw: email(
        "issuance-trap",
        "青禾消费人才测评 <assessment@qinghe-consumer.example>",
        "青禾消费 管培生项目 测评邀请",
        [
          "你好，",
          "",
          `本次测评邀请于 ${issuedAt} 生效。请在 3 天内完成全部题目。`,
          "测评入口：https://talent.qinghe-consumer.example/t/q8n4 （链接为个人专属，请勿转发）",
          "测评地点不限，建议使用电脑端。青禾消费（杭州）人力资源部",
        ].join("\n"),
      ),
      tokens: { ISSUED_AT: issuedAt },
    },
    {
      id: "english-hk",
      title: "英文面试邀请：香港",
      teaches: "邮件是英文的，但事件在香港。时区来自信里写明的 HKT，语言不参与推断。",
      raw: email(
        "english-hk",
        "Aurora Pacific Bank Graduate Recruitment <graduates@aurorapacific.example>",
        "Interview Invitation - Graduate Programme 2027",
        [
          "Dear Candidate,",
          "",
          "Thank you for your application to the Aurora Pacific Bank Graduate Programme.",
          `Your video interview is scheduled for ${hkDay} at 14:00 (HKT).`,
          "The interview will last approximately 45 minutes.",
          "Join via Zoom: https://meet.aurorapacific.example/j/gp-interview",
          "Meeting ID: 882 134 507, Passcode: 60417",
          "",
          "Graduate Recruitment Team, Hong Kong",
        ].join("\n"),
      ),
      tokens: { HK_DAY: hkDay },
    },
    {
      id: "phone-interview",
      title: "电话面试",
      teaches: "同样是面试，电话面不用开摄像头、但要找安静的地方。形式要单独认出来，不能只写「面试」。",
      raw: email(
        "phone-interview",
        "云帆物流招聘 <careers@yunfan-logistics.example>",
        "云帆物流 管理培训生 电话面试安排",
        [
          "你好，",
          "",
          "恭喜你通过云帆物流管理培训生的简历筛选。",
          `我们将于 ${phoneDay} 15:30（北京时间）与你进行电话面试，时长约 20 分钟，请保持手机畅通。`,
          "",
          "云帆物流（深圳）人力资源部",
        ].join("\n"),
      ),
      tokens: { PHONE_DAY: phoneDay },
    },
    {
      id: "ai-interview",
      title: "AI 面试：限期完成",
      teaches: "名字里有「面试」，但对面不是真人，也没有固定场次，只要在截止前自己录完。既不能当成视频面试，也不能当成准点开始的事。",
      raw: email(
        "ai-interview",
        "北辰咨询招聘 <hr@beichen-consulting.example>",
        "【北辰咨询】AI 面试邀请",
        [
          "你好，",
          "",
          "你已进入北辰咨询咨询顾问岗位的下一环节：AI 视频面试。",
          `请于 ${aiDay} 23:59（北京时间）前完成，系统将录制你的作答，全程约 25 分钟。`,
          "面试无真人面试官在线，可在截止前任意时间开始。",
          "面试入口：https://ai-interview.beichen-consulting.example/r/5c1d",
        ].join("\n"),
      ),
      tokens: { AI_DAY: aiDay },
    },
    {
      id: "us-assessment",
      title: "美国在线测评：ET 截止",
      teaches: "美国邮件：月在前的日期写法、12 小时制、时区缩写 ET。夏令时期间 ET 实际是 UTC-4，换算交给系统时区库，不手写偏移。",
      raw: email(
        "us-assessment",
        "Northwind Analytics Recruiting <no-reply@northwind-analytics.example>",
        "Your Online Assessment for Business Analyst",
        [
          "Hi,",
          "",
          "Thank you for applying to the Business Analyst role at Northwind Analytics.",
          `Please complete the online assessment by ${usDueDay} at 11:59 PM ET. It takes about 60 minutes.`,
          "Assessment link: https://assess.northwind-analytics.example/t/9k2",
          "Access code: NW-48Q7-TZ",
          "",
          "Northwind Analytics Recruiting, New York",
        ].join("\n"),
      ),
      tokens: { US_DUE_DAY: usDueDay },
    },
    {
      id: "us-phone-screen",
      title: "美国电话初筛：PT",
      teaches: "英文里电话面试常叫 phone screen，不出现 interview 这个词，也要认成面试。时间是太平洋时间。",
      raw: email(
        "us-phone-screen",
        "Sierra Robotics Talent <talent@sierra-robotics.example>",
        "Phone screen with Sierra Robotics",
        [
          "Hi there,",
          "",
          "Thanks for your interest in the Operations Associate role at Sierra Robotics.",
          `We'd like to schedule a 30-minute phone screen on ${usPhoneDay} at 10:00 AM PT.`,
          "Our recruiter will call you at the number on your resume.",
        ].join("\n"),
      ),
      tokens: { US_PHONE_DAY: usPhoneDay },
    },
    {
      id: "us-rejection",
      title: "英文拒信",
      teaches: "英文拒信几乎都以 Thank you for applying 开头。不能因为这句就判成「投递成功」，要看到后面的决定。",
      raw: email(
        "us-rejection",
        "Atlas Consulting <no-reply@atlas-consulting.example>",
        "Update on your application",
        [
          "Dear Applicant,",
          "",
          "Thank you for applying to the Associate Consultant position at Atlas Consulting.",
          "After careful consideration, we regret to inform you that we will not be moving forward with your application.",
          "We wish you the best in your search.",
        ].join("\n"),
        2,
      ),
      tokens: {},
    },
    {
      id: "no-timezone",
      title: "英文面试邀请：没写时区",
      teaches: "有钟点，但信里没有任何地点或时区线索。系统承认不知道，交给你确认，而不是默认成某个时区。",
      raw: email(
        "no-timezone",
        "Meridian Partners Talent <no-reply@ats-notify.example>",
        "Your interview with Meridian Partners",
        [
          "Hi,",
          "",
          "We are pleased to invite you to a first-round interview for the Analyst role.",
          `Your interview is scheduled for ${plainDay} at 10:00.`,
          "A calendar link will follow.",
        ].join("\n"),
      ),
      tokens: { PLAIN_DAY: plainDay },
    },
    {
      id: "reminder",
      title: "催办：和第一封是同一件事",
      teaches: "这是对同一场笔试的再次提醒，不是一件新的事。应当并入已有记录，而不是另起一条。",
      raw: email(
        "reminder",
        "星河科技校园招聘 <campus@xinghe-tech.example>",
        "【提醒】星河科技在线笔试即将开始",
        [
          "同学你好，",
          "",
          `温馨提醒：你报名的星河科技在线笔试将于 ${examDay} 19:00（北京时间）开考，请勿错过。`,
        ].join("\n"),
      ),
      tokens: { EXAM_DAY: examDay },
    },
    {
      id: "application-ok",
      title: "投递成功回执",
      teaches: "只是确认收到简历，没有需要你做的事，也没有时间。不该因为缺时间就被打成「待确认」。",
      raw: email(
        "application-ok",
        "云帆物流招聘 <careers@yunfan-logistics.example>",
        "云帆物流：我们已收到你的申请",
        [
          "你好，",
          "",
          "感谢你申请云帆物流 2027 届管理培训生。我们已收到你的简历，",
          "招聘团队会在筛选后与合适的候选人联系。",
        ].join("\n"),
        10,
      ),
      tokens: {},
    },
    {
      id: "noise",
      title: "噪音：验证码",
      teaches: "招聘网站发来的验证码不是求职事件，在第一道预筛就应当丢掉。",
      raw: email(
        "noise",
        "云帆物流招聘 <careers@yunfan-logistics.example>",
        "你的登录验证码",
        "你的验证码是 384920，10 分钟内有效。如非本人操作请忽略。",
      ),
      tokens: {},
    },

    // ---- 以下是「历史」：过去几周陆续收到的邮件，让投递表和统计不至于只有今天这一天 ----
    receipt("hist-xinghe-apply", "星河科技", "xinghe-tech", "商业分析师", 18),
    receipt("hist-beichen-apply", "北辰咨询", "beichen-consulting", "咨询顾问（上海）", 15),
    receipt("hist-qinghe-apply", "青禾消费", "qinghe-consumer", "管培生项目", 9),
    receipt("hist-yuanshan-apply", "远山新能源", "yuanshan-energy", "海外市场专员", 22),
    {
      id: "hist-yuanshan-round2",
      title: "二面邀请",
      teaches: "写明了是第二轮面试。投递表里的状态应当是「面试 · 二面」，而不只是「面试」。",
      raw: email(
        "hist-yuanshan-round2",
        "远山新能源招聘 <hr@yuanshan-energy.example>",
        "【远山新能源】二面邀请",
        [
          "你好，",
          "",
          "恭喜你通过一面。现邀请你参加海外市场专员岗位的第二轮面试，形式为视频面试。",
          `面试时间：${round2Day} 14:00（北京时间），时长约 40 分钟。`,
          "腾讯会议号：418 220 937",
          "",
          "远山新能源（苏州）人力资源部",
        ].join("\n"),
        1,
      ),
      tokens: { ROUND2_DAY: round2Day },
    },
    receipt("hist-songjian-apply", "松间科技", "songjian-tech", "产品运营", 21),
    {
      id: "hist-songjian-final",
      title: "终面通知",
      teaches: "终面，线下。状态应当是「面试 · 终面」。",
      raw: email(
        "hist-songjian-final",
        "松间科技招聘 <hr@songjian-tech.example>",
        "【松间科技】终面通知",
        [
          "你好，",
          "",
          "恭喜你进入产品运营岗位的终面。本轮为线下面试。",
          `面试时间：${finalDay} 10:00（北京时间）`,
          "面试地点：上海市浦东新区松间科技总部 3 楼",
          "",
          "松间科技人力资源部",
        ].join("\n"),
        2,
      ),
      tokens: { FINAL_DAY: finalDay },
    },
    receipt("hist-haianxian-apply", "海岸线传媒", "haianxian-media", "内容策划", 25),
    {
      id: "hist-haianxian-offer",
      title: "录用通知",
      teaches: "结果通知里的好消息。投递表里应当是「Offer」，不能和拒信混成同一种「有结果」。",
      raw: email(
        "hist-haianxian-offer",
        "海岸线传媒招聘 <hr@haianxian-media.example>",
        "【海岸线传媒】录用通知",
        [
          "你好，",
          "",
          "恭喜你！经综合评估，我们决定向你发出内容策划岗位的录用意向。",
          "Offer 详情与入职材料清单将由 HR 另行发送，请留意邮箱。",
          "",
          "海岸线传媒人力资源部",
        ].join("\n"),
        3,
      ),
      tokens: {},
    },
    receipt("hist-zhixing-apply", "知行教育", "zhixing-edu", "课程运营", 14),
    {
      id: "hist-zhixing-reject",
      title: "中文拒信",
      teaches: "中文拒信的常见说法。投递表里应当是「未通过」。",
      raw: email(
        "hist-zhixing-reject",
        "知行教育招聘 <hr@zhixing-edu.example>",
        "【知行教育】应聘结果通知",
        [
          "你好，",
          "",
          "感谢你应聘知行教育课程运营岗位。很遗憾，经过慎重评估，你与该岗位的要求暂不匹配，",
          "本次未能进入下一阶段。我们已将你的资料存入人才库，期待未来有机会合作。",
        ].join("\n"),
        5,
      ),
      tokens: {},
    },
    receipt("hist-moshi-apply", "墨石资本", "moshi-capital", "投资助理", 7),
    {
      id: "hist-moshi-update",
      title: "补材料",
      teaches: "要你补充登记表。不是测评也不是面试，状态应当是「待补材料」。",
      raw: email(
        "hist-moshi-update",
        "墨石资本招聘 <hr@moshi-capital.example>",
        "【墨石资本】请完善网申登记表信息",
        [
          "你好，",
          "",
          "你的网申登记表中有部分必填信息缺失，可能影响后续流程安排。",
          "请尽快登录网申系统补充完整：https://apply.moshi-capital.example/form/u3k9",
        ].join("\n"),
        3,
      ),
      tokens: {},
    },
    receipt("hist-lanwan-apply", "澜湾医疗", "lanwan-medical", "市场专员", 2),
    receipt("hist-qiyun-apply", "栖云酒店集团", "qiyun-hotels", "管理培训生", 4),
  ];
}
