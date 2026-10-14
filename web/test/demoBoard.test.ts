import { beforeAll, describe, expect, it } from "vitest";
import { applyEdits, buildAgenda, calendarItems } from "@/lib/demo/agenda";
import type { AgendaItem } from "@/lib/demo/agenda";
import {
  buildApplications,
  interviewRound,
  nextText,
  resultKind,
  stageText,
} from "@/lib/demo/applications";
import type { ApplicationEmail, ApplicationRow } from "@/lib/demo/applications";
import { notParsedResult, pendingReason, runDemoParse, timeSummary, toDemoResult } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";
import { buildSampleEmails } from "@/lib/demo/sampleEmails";
import { funnel, handling, kpis, stageDistribution, upcomingLoad, weeklyEmails } from "@/lib/demo/stats";
import {
  addManualApplication,
  addManualEvent,
  decide,
  EMPTY_EDITS,
  forgetCompanyZone,
  isTimeZone,
  rememberCompanyZone,
  hasEdits,
  kindChoice,
  kindIdOf,
  localInputToUtc,
  parseEdits,
  patchApplication,
  removeManualApplication,
  removeManualEvent,
  resolveTime,
  undecide,
  unpatchApplication,
  utcToLocalInput,
} from "@/lib/demo/userEdits";
import type { UserEdits } from "@/lib/demo/userEdits";
import { EMPTY_EXTRACTION, parseEmail } from "@/lib/tracker-core/index";
import type { LLMExtractor } from "@/lib/tracker-core/index";

/**
 * 主看板上「人能动手改」的那一层：待确认的去向、日程的增删、投递表、统计。
 *
 * 公司名由下面这张固定的表给出（代替模型摘公司名这一步），其余全部由规则现场解析。
 * 不用仓库里随附的模型录制：那份文件会随重新录制而变，测试不该跟着它漂。
 */
const COMPANY: Readonly<Record<string, string>> = {
  "fixed-exam": "星河科技",
  reminder: "星河科技",
  "relative-deadline": "北辰咨询",
  "ai-interview": "北辰咨询",
  "issuance-trap": "青禾消费",
  "english-hk": "Aurora Pacific Bank",
  "phone-interview": "云帆物流",
  "application-ok": "云帆物流",
  "us-assessment": "Northwind Analytics",
  "us-phone-screen": "Sierra Robotics",
  "us-rejection": "Atlas Consulting",
  "no-timezone": "Meridian Partners",
};

function extractorFor(sampleId: string): LLMExtractor | undefined {
  const companyRaw = COMPANY[sampleId];
  if (companyRaw === undefined) return undefined; // 历史样本标题带【公司】，规则自己摘得出
  return { extract: () => Promise.resolve({ ...EMPTY_EXTRACTION, companyRaw }) };
}

// 2026-10-09 23:20 北京时间 = 纽约 11:20
const NOW = Date.parse("2026-10-09T15:20:00.000Z");
const NY = "America/New_York";
const samples = buildSampleEmails(NOW);

let results: Map<string, DemoResult>;
let base: AgendaItem[];

beforeAll(async () => {
  results = new Map(
    await Promise.all(
      samples.map(async (s) => {
        const extractor = extractorFor(s.id);
        const result = await runDemoParse(s.raw, { viewerTimeZone: NY, ...(extractor ? { extractor } : {}) });
        return [s.id, result] as const;
      }),
    ),
  );
  base = buildAgenda(
    samples.map((s) => ({ sampleId: s.id, subject: s.raw.subject, result: results.get(s.id) as DemoResult })),
  );
});

const itemOf = (items: readonly AgendaItem[], sampleId: string): AgendaItem => {
  const found = items.find((i) => i.sources.some((s) => s.sampleId === sampleId));
  if (!found) throw new Error(`日程里没有 ${sampleId}`);
  return found;
};

function applicationsOf(agenda: readonly AgendaItem[], edits: UserEdits = EMPTY_EDITS): ApplicationRow[] {
  const placeOf = new Map<string, AgendaItem["place"]>();
  for (const item of agenda) for (const source of item.sources) placeOf.set(source.sampleId, item.place);
  const emails: ApplicationEmail[] = samples.map((s) => ({
    sampleId: s.id,
    subject: s.raw.subject,
    body: s.raw.body,
    receivedAtUtc: s.raw.receivedAtUtc,
    result: results.get(s.id) as DemoResult,
    place: placeOf.get(s.id) ?? "ignored",
  }));
  return buildApplications(emails, agenda, edits, NOW);
}
const rowOf = (rows: readonly ApplicationRow[], company: string): ApplicationRow => {
  const found = rows.find((r) => r.company === company);
  if (!found) throw new Error(`投递表里没有 ${company}`);
  return found;
};

describe("一件事摆在哪", () => {
  it("回执和结果通知不占日程，只记在投递表", () => {
    expect(itemOf(base, "application-ok").place).toBe("tracked");
    expect(itemOf(base, "us-rejection").place).toBe("tracked");
    expect(itemOf(base, "hist-haianxian-offer").place).toBe("tracked");
  });

  it("系统拿不准的回执 / 拒信也不进待确认：只记在投递表", () => {
    const receipt = itemOf(base, "application-ok");
    const rejection = itemOf(base, "us-rejection");
    const unsure = buildAgenda([
      { sampleId: "r1", subject: "感谢投递", result: { ...receipt.result, destination: "pending", dedupKey: "r1" } },
      { sampleId: "r2", subject: "结果通知", result: { ...rejection.result, destination: "pending", dedupKey: "r2" } },
      { sampleId: "r3", subject: "测评邀请", result: { ...itemOf(base, "fixed-exam").result, destination: "pending", dedupKey: "r3" } },
    ]);
    expect(Object.fromEntries(unsure.map((i) => [i.id, i.place]))).toEqual({ r1: "tracked", r2: "tracked", r3: "pending" });
  });

  it("测评、面试、补材料在日程上", () => {
    expect(itemOf(base, "fixed-exam").place).toBe("board");
    expect(itemOf(base, "phone-interview").place).toBe("board");
    expect(itemOf(base, "hist-moshi-update").place).toBe("board");
  });

  it("拿不准的在待确认；稳定标识是最早那封邮件的 id，不带日期", () => {
    const item = itemOf(base, "no-timezone");
    expect(item.place).toBe("pending");
    expect(item.id).toBe("no-timezone");
    expect(itemOf(base, "reminder").id).toBe("fixed-exam");
  });
});

describe("待确认的三个去向", () => {
  it("放进日程并补上时间：出现在日程和日历上，时间按你填的时区解释", () => {
    const time = resolveTime("fixed_start", "2026-10-15T10:00", NY);
    expect(time).not.toBeNull();
    const edits = decide(EMPTY_EDITS, "no-timezone", { action: "confirm", kind: "video_interview", time });
    const agenda = applyEdits(base, edits, NY);
    const item = itemOf(agenda, "no-timezone");
    expect(item.place).toBe("board");
    expect(item.result.kindLabel).toBe("视频面试");
    expect(item.result.dueType).toBe("fixed_start");
    expect(item.result.when?.utc).toBe("2026-10-15T14:00:00.000Z");
    expect(item.result.timeZone).toBe(NY);
    expect(calendarItems(agenda).some((i) => i.id === "no-timezone")).toBe(true);
    expect(timeSummary(item.result, NY).text).toBe("10月15日 周四 10:00");
  });

  it("放进日程但说明没有具体时间：在日程上，不在日历上，不再写「时间待确认」", () => {
    const edits = decide(EMPTY_EDITS, "no-timezone", {
      action: "confirm",
      kind: null,
      time: resolveTime("none", "", NY),
    });
    const agenda = applyEdits(base, edits, NY);
    const item = itemOf(agenda, "no-timezone");
    expect(item.place).toBe("board");
    expect(item.result.when).toBeNull();
    expect(timeSummary(item.result, NY).text).toBe("没有具体时间");
    expect(calendarItems(agenda).some((i) => i.id === "no-timezone")).toBe(false);
  });

  it("什么都不改直接确认：类型沿用系统的判断", () => {
    const agenda = applyEdits(base, decide(EMPTY_EDITS, "no-timezone", { action: "confirm", kind: null, time: null }), NY);
    const item = itemOf(agenda, "no-timezone");
    expect(item.place).toBe("board");
    expect(item.result.eventType).toBe("interview");
  });

  it("只记到投递表：不上日程，但这家公司出现在投递表里，状态算数", () => {
    const agenda = applyEdits(base, decide(EMPTY_EDITS, "no-timezone", { action: "track" }), NY);
    expect(itemOf(agenda, "no-timezone").place).toBe("tracked");
    const row = rowOf(applicationsOf(agenda), "Meridian Partners");
    expect(row.stage).toBe("interview");
    expect(row.round).toBe("一面");
    expect(row.pendingCount).toBe(0);
  });

  it("忽略：哪里都不记", () => {
    const agenda = applyEdits(base, decide(EMPTY_EDITS, "no-timezone", { action: "ignore" }), NY);
    expect(itemOf(agenda, "no-timezone").place).toBe("ignored");
    expect(applicationsOf(agenda).some((r) => r.company === "Meridian Partners")).toBe(false);
  });

  it("撤销后回到系统原本放的位置", () => {
    const edits = undecide(decide(EMPTY_EDITS, "no-timezone", { action: "ignore" }), "no-timezone");
    expect(hasEdits(edits)).toBe(false);
    expect(itemOf(applyEdits(base, edits, NY), "no-timezone").place).toBe("pending");
  });

  it("没处理时，待确认的邮件不参与状态推断，但这家公司仍然有一行", () => {
    const row = rowOf(applicationsOf(base), "Meridian Partners");
    expect(row.stage).toBe("applied");
    expect(row.pendingCount).toBe(1);
    expect(nextText(row, NY)).toBe("有 1 件事等你确认");
  });
});

describe("日程的添加与删除", () => {
  const manual = {
    id: "m1",
    company: "测试公司",
    role: "分析师",
    kind: "onsite_interview" as const,
    timeKind: "fixed_start" as const,
    startUtc: "2026-10-20T14:00:00.000Z",
    timeZone: NY,
    createdAtMs: NOW,
  };

  it("手动添加的日程出现在日程和日历上，按时间排进去", () => {
    const agenda = applyEdits(base, addManualEvent(EMPTY_EDITS, manual), NY);
    const item = agenda.find((i) => i.id === "manual:m1");
    expect(item?.place).toBe("board");
    expect(item?.origin).toBe("manual");
    expect(item?.result.kindLabel).toBe("线下面试");
    expect(item?.result.when?.viewer).toBe("10月20日 周二 10:00");
    expect(calendarItems(agenda).some((i) => i.id === "manual:m1")).toBe(true);
    const timed = agenda.filter((i) => i.result.when !== null).map((i) => i.result.when?.utc ?? "");
    expect([...timed].sort()).toEqual(timed);
  });

  it("删除手动日程后它彻底消失", () => {
    const edits = removeManualEvent(addManualEvent(EMPTY_EDITS, manual), "m1");
    expect(applyEdits(base, edits, NY).some((i) => i.id === "manual:m1")).toBe(false);
    expect(hasEdits(edits)).toBe(false);
  });

  it("把邮件解析出来的事移出日程：日历上没有了，但投递状态不倒退", () => {
    const agenda = applyEdits(base, decide(EMPTY_EDITS, "phone-interview", { action: "remove" }), NY);
    expect(itemOf(agenda, "phone-interview").place).toBe("tracked");
    expect(calendarItems(agenda).some((i) => i.id === "phone-interview")).toBe(false);
    expect(rowOf(applicationsOf(agenda), "云帆物流").stage).toBe("interview");
  });

  it("没有时间的手动日程", () => {
    const agenda = applyEdits(
      base,
      addManualEvent(EMPTY_EDITS, { ...manual, timeKind: "none", startUtc: null }),
      NY,
    );
    const item = agenda.find((i) => i.id === "manual:m1");
    expect(item?.result.when).toBeNull();
    expect(item?.result.role).toBe("分析师");
  });
});

describe("投递表", () => {
  it("一家公司一行，状态取走到的最远一步", () => {
    const rows = applicationsOf(base);
    expect(rows).toHaveLength(16);
    expect(stageText(rowOf(rows, "星河科技"))).toBe("测评");
    expect(stageText(rowOf(rows, "北辰咨询"))).toBe("面试");
    expect(stageText(rowOf(rows, "远山新能源"))).toBe("面试 · 二面");
    expect(stageText(rowOf(rows, "松间科技"))).toBe("面试 · 终面");
    expect(stageText(rowOf(rows, "墨石资本"))).toBe("待补材料");
    expect(stageText(rowOf(rows, "海岸线传媒"))).toBe("Offer");
    expect(stageText(rowOf(rows, "知行教育"))).toBe("未通过");
    expect(stageText(rowOf(rows, "Atlas Consulting"))).toBe("未通过");
    expect(stageText(rowOf(rows, "澜湾医疗"))).toBe("已投递");
  });

  it("催办和原通知算同一家公司的邮件，验证码不算", () => {
    const row = rowOf(applicationsOf(base), "星河科技");
    expect(row.emailIds).toEqual(["hist-xinghe-apply", "fixed-exam", "reminder"]);
    expect(applicationsOf(base).some((r) => r.emailIds.includes("noise"))).toBe(false);
  });

  it("下一步是这家公司日程上最近的一件事", () => {
    const rows = applicationsOf(base);
    expect(nextText(rowOf(rows, "星河科技"), NY)).toBe("笔试 · 10月14日 周三 07:00");
    expect(nextText(rowOf(rows, "北辰咨询"), NY)).toBe("在线测评 · 10月12日 周一 11:20 前");
    expect(nextText(rowOf(rows, "墨石资本"), NY)).toBe("流程更新（没有具体时间）");
    expect(nextText(rowOf(rows, "澜湾医疗"), NY)).toBe("等待筛选结果");
    expect(nextText(rowOf(rows, "知行教育"), NY)).toBe("—");
  });

  it("最近有动静的排前面；最早与最近的日期来自邮件", () => {
    const rows = applicationsOf(base);
    const times = rows.map((r) => Date.parse(r.lastSeenUtc ?? ""));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const yuanshan = rowOf(rows, "远山新能源");
    expect(yuanshan.firstSeenUtc).toBe(new Date(NOW - 22 * 86_400_000).toISOString());
    expect(yuanshan.lastSeenUtc).toBe(new Date(NOW - 86_400_000).toISOString());
  });

  it("手动改状态以你的为准，可以恢复", () => {
    const key = rowOf(applicationsOf(base), "澜湾医疗").key;
    const patched = patchApplication(EMPTY_EDITS, key, { stage: "interview", round: "终面" });
    const row = rowOf(applicationsOf(base, patched), "澜湾医疗");
    expect(stageText(row)).toBe("面试 · 终面");
    expect(row.manualStage).toBe(true);
    expect(row.reach).toBe("interview");
    const restored = rowOf(applicationsOf(base, unpatchApplication(patched, key)), "澜湾医疗");
    expect(stageText(restored)).toBe("已投递");
    expect(restored.manualStage).toBe(false);
  });

  it("非面试状态不带轮次", () => {
    const key = rowOf(applicationsOf(base), "澜湾医疗").key;
    const row = rowOf(applicationsOf(base, patchApplication(EMPTY_EDITS, key, { stage: "assessment", round: "二面" })), "澜湾医疗");
    expect(row.round).toBeNull();
  });

  it("手动添加和删除一条投递", () => {
    const added = addManualApplication(EMPTY_EDITS, {
      id: "a1",
      company: "手动公司",
      role: "",
      stage: "interview",
      round: "二面",
      appliedOn: "2026-10-01",
      createdAtMs: NOW,
    });
    const row = rowOf(applicationsOf(base, added), "手动公司");
    expect(row.origin).toBe("manual");
    expect(row.role).toBeNull();
    expect(stageText(row)).toBe("面试 · 二面");
    expect(row.firstSeenUtc).toBe("2026-10-01T12:00:00.000Z");
    const patched = patchApplication(added, "manual:a1", { stage: "offer", round: null });
    expect(stageText(rowOf(applicationsOf(base, patched), "手动公司"))).toBe("Offer");
    const removed = removeManualApplication(patched, "a1");
    expect(applicationsOf(base, removed).some((r) => r.company === "手动公司")).toBe(false);
    expect(hasEdits(removed)).toBe(false);
  });

  it("没填投递日期的手动记录排在最后，不报错", () => {
    const added = addManualApplication(EMPTY_EDITS, {
      id: "a2",
      company: "没日期公司",
      role: "岗位",
      stage: "applied",
      round: null,
      appliedOn: "",
      createdAtMs: NOW,
    });
    const rows = applicationsOf(base, added);
    expect(rows[rows.length - 1]?.company).toBe("没日期公司");
  });
});

describe("轮次与结果的识别", () => {
  it("只认明写的轮次；终面优先", () => {
    expect(interviewRound("恭喜你通过一面，现邀请你参加第二轮面试")).toBe("二面");
    expect(interviewRound("终面（三面）通知")).toBe("终面");
    expect(interviewRound("三面安排")).toBe("三面");
    expect(interviewRound("first-round interview")).toBe("一面");
    expect(interviewRound("Final round interview / Superday")).toBe("终面");
    expect(interviewRound("电话面试安排")).toBeNull();
  });

  it("拒信先判；两边都认不出就是不知道", () => {
    expect(resultKind("感谢应聘，很遗憾未能进入下一阶段")).toBe("rejected");
    expect(resultKind("We regret to inform you")).toBe("rejected");
    expect(resultKind("恭喜你！我们决定向你发出录用意向")).toBe("offer");
    expect(resultKind("We are pleased to offer you the position")).toBe("offer");
    expect(resultKind("你的申请状态有更新，请登录查看")).toBeNull();
  });
});

describe("统计", () => {
  it("四个数字", () => {
    const k = kpis(applicationsOf(base), base, NOW);
    expect(k.applications).toBe(16);
    expect(k.active).toBe(13);
    expect(k.pending).toBe(1);
    // 未来 7×24 小时内：北辰测评、青禾测评、云帆电话面、北辰 AI 面、星河笔试、Sierra 电话初筛、远山二面。
    // Northwind 的测评截止在第 7 天深夜（纽约时间），已经超出 7×24 小时，不算。
    expect(k.dueThisWeek).toBe(7);
  });

  it("漏斗每一步不超过上一步，第一步等于投递总数", () => {
    const steps = funnel(applicationsOf(base));
    expect(steps.map((s) => s.count)).toEqual([16, 10, 7, 1]);
    expect(steps[0]?.fromPrevious).toBeNull();
    expect(steps[1]?.fromPrevious).toBeCloseTo(10 / 16);
    expect(steps[3]?.share).toBeCloseTo(1 / 16);
  });

  it("空表的漏斗全是 0，不除以零", () => {
    expect(funnel([]).map((s) => [s.count, s.share, s.fromPrevious])).toEqual([
      [0, 0, null],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  it("状态分布加起来等于总数", () => {
    const dist = stageDistribution(applicationsOf(base));
    expect(dist.reduce((sum, d) => sum + d.count, 0)).toBe(16);
    expect(Object.fromEntries(dist.map((d) => [d.label, d.count]))).toEqual({
      已投递: 3,
      待补材料: 1,
      测评: 3,
      面试: 6,
      Offer: 1,
      未通过: 2,
    });
  });

  it("接下来两周：按你所在时区的日期落位，从今天开始连续 14 天", () => {
    const days = upcomingLoad(base, NOW, NY);
    expect(days).toHaveLength(14);
    expect(days[0]?.dateKey).toBe("2026-10-09");
    expect(days[0]?.weekday).toBe("周五");
    const total = days.reduce((sum, d) => sum + d.fixed + d.deadline, 0);
    expect(total).toBe(10);
    const oct14 = days.find((d) => d.dateKey === "2026-10-14");
    expect(oct14?.fixed).toBe(2);
    // 北京时间 10/17 14:00 的香港面试，对纽约是 10/17 凌晨 2 点
    expect(days.find((d) => d.dateKey === "2026-10-17")?.fixed).toBe(1);
  });

  it("每周邮件数：验证码不算，最后一格是本周", () => {
    const emails = samples.map((s) => ({
      receivedAtUtc: s.raw.receivedAtUtc,
      destination: (results.get(s.id) as DemoResult).destination,
    }));
    const weeks = weeklyEmails(emails, NOW, NY);
    expect(weeks).toHaveLength(5);
    expect(weeks[4]?.label).toBe("本周");
    expect(weeks[4]?.weekStart).toBe("2026-10-05");
    expect(weeks.reduce((sum, w) => sum + w.count, 0)).toBe(27);
  });

  it("系统自己处理了多少：按最初的判断算", () => {
    const counts = handling(samples.map((s) => ({ destination: (results.get(s.id) as DemoResult).destination })));
    expect(Object.fromEntries(counts.map((c) => [c.id, c.count]))).toEqual({ auto: 26, pending: 1, ignored: 1 });
  });
});

describe("手动操作的存取", () => {
  it("本地时间与绝对时刻互转，夏令时由时区库处理", () => {
    expect(localInputToUtc("2026-10-15T10:00", NY)).toBe("2026-10-15T14:00:00.000Z");
    expect(localInputToUtc("2026-12-15T10:00", NY)).toBe("2026-12-15T15:00:00.000Z");
    expect(utcToLocalInput("2026-10-15T14:00:00.000Z", NY)).toBe("2026-10-15T10:00");
    expect(utcToLocalInput("2026-10-15T16:00:00.000Z", "Asia/Shanghai")).toBe("2026-10-16T00:00");
  });

  it("填得不对的时间不换算", () => {
    expect(localInputToUtc("", NY)).toBeNull();
    expect(localInputToUtc("2026-10-15", NY)).toBeNull();
    expect(localInputToUtc("2026-10-15T10:00", "Not/AZone")).toBeNull();
    expect(resolveTime("fixed_start", "", NY)).toBeNull();
    expect(resolveTime("none", "乱填", NY)).toEqual({ timeKind: "none", startUtc: null, timeZone: NY });
  });

  it("表单选项与引擎类型互查", () => {
    expect(kindIdOf("interview", "phone_interview")).toBe("phone_interview");
    expect(kindIdOf("interview", "unspecified")).toBe("interview");
    expect(kindIdOf("assessment", "unspecified")).toBe("online_assessment");
    expect(kindIdOf("update", "not_applicable")).toBe("update");
    expect(kindIdOf("result", "not_applicable")).toBe("other");
    expect(kindIdOf(null, null)).toBe("other");
    expect(kindChoice("written_test").label).toBe("笔试");
  });

  it("存进去再读出来不变", () => {
    let edits = decide(EMPTY_EDITS, "a", { action: "confirm", kind: "written_test", time: resolveTime("deadline", "2026-10-15T10:00", NY) });
    edits = decide(edits, "b", { action: "track" });
    edits = decide(edits, "c", { action: "confirm", kind: null, time: null });
    edits = addManualEvent(edits, { id: "m", company: "X", role: "", kind: "other", timeKind: "none", startUtc: null, timeZone: NY, createdAtMs: 1 });
    edits = patchApplication(edits, "k", { stage: "interview", round: "三面" });
    edits = addManualApplication(edits, { id: "p", company: "Y", role: "R", stage: "offer", round: null, appliedOn: "2026-10-01", createdAtMs: 2 });
    expect(parseEdits(JSON.parse(JSON.stringify(edits)))).toEqual(edits);
  });

  it("读到乱七八糟的东西：坏的那条丢掉，好的留下，不抛异常", () => {
    expect(parseEdits(null)).toEqual(EMPTY_EDITS);
    expect(parseEdits("x")).toEqual(EMPTY_EDITS);
    expect(parseEdits({ version: 2 })).toEqual(EMPTY_EDITS);
    const parsed = parseEdits({
      version: 1,
      decisions: {
        good: { action: "ignore" },
        bad: { action: "explode" },
        notObject: 3,
        badKind: { action: "confirm", kind: "nope", time: { timeKind: "fixed_start", startUtc: "不是时间", timeZone: NY } },
      },
      manualEvents: [
        { id: "ok", company: "A", kind: "other", timeKind: "none", timeZone: NY },
        { id: "noTime", company: "B", kind: "other" },
        { id: 5, company: "C", kind: "other", timeKind: "none", timeZone: NY },
        "junk",
      ],
      applicationPatches: { ok: { stage: "offer" }, bad: { stage: "???" }, alsoBad: null },
      manualApplications: [{ id: "ok", company: "A", stage: "applied" }, { id: "bad", company: "B", stage: "x" }, 7],
    });
    expect(Object.keys(parsed.decisions).sort()).toEqual(["badKind", "good"]);
    expect(parsed.decisions.badKind).toEqual({ action: "confirm", kind: null, time: null });
    expect(parsed.manualEvents.map((e) => e.id)).toEqual(["ok"]);
    expect(parsed.manualEvents[0]?.role).toBe("");
    expect(parsed.applicationPatches).toEqual({ ok: { stage: "offer", round: null } });
    expect(parsed.manualApplications).toEqual([
      { id: "ok", company: "A", role: "", stage: "applied", round: null, appliedOn: "", createdAtMs: 0 },
    ]);
  });

  it("字段形状不对的整块跳过", () => {
    const parsed = parseEdits({ version: 1, decisions: [], manualEvents: {}, applicationPatches: "x", manualApplications: null });
    expect(parsed).toEqual(EMPTY_EDITS);
  });
});

describe("待确认卡片上的「为什么拿不准」", () => {
  const withReasons = (confidenceReasons: string[], dueReason = ""): DemoResult => ({
    ...(results.get("no-timezone") as DemoResult),
    confidenceReasons,
    dueReason,
  });

  it("没写时区的面试邀请", () => {
    expect(pendingReason(results.get("no-timezone") as DemoResult)).toBe("信里写了时间，但没说是哪个时区的。");
  });

  it("每一种引擎理由都有一句平常话", () => {
    expect(pendingReason(withReasons(["没有解析出公司名：无法归属到任何一次投递"]))).toContain("哪家公司");
    expect(pendingReason(withReasons(["规则判为 assessment，但模型认为这不是一件流程事件"]))).toContain("无关");
    expect(pendingReason(withReasons(["规则判为 assessment，模型判为 application_ok，两边不一致"]))).toContain("看法不同");
    expect(pendingReason(withReasons(["模型圈出的那句话里没有场次，但全文另有一个未到的场次；已按场次优先采用"]))).toContain("不止一个时间");
    expect(pendingReason(withReasons(["interview 类事件没有解析出任何时间，必须人工确认"]))).toContain("没读到");
    expect(pendingReason(withReasons(["时间语义置信度为 low"], "日/月顺序存在歧义：已取较早的一解"))).toContain("两种读法");
    expect(pendingReason(withReasons(["事件类型来自模型建议而非规则命中"]))).toContain("模型建议");
    expect(pendingReason(withReasons(["时间语义置信度为 low"]))).toContain("不够有把握");
  });

  it("对不上任何已知理由时不编，指向详情", () => {
    expect(pendingReason(withReasons(["一条以后才会出现的新理由"]))).toContain("详情");
    expect(pendingReason(withReasons([]))).toContain("详情");
  });
});

describe("私人看板复用同一套翻译", () => {
  it("收信程序存下的结论（JSON 往返一次）翻译出来和演示站现场解析的一模一样", async () => {
    for (const id of ["fixed-exam", "no-timezone", "us-rejection", "noise", "hist-yuanshan-round2"]) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) throw new Error(id);
      const extractor = extractorFor(id);
      const outcome = await parseEmail(sample.raw, { extractor: extractor ?? { extract: () => Promise.resolve({ ...EMPTY_EXTRACTION }) } });
      const stored = JSON.parse(JSON.stringify(outcome));
      const live = toDemoResult(stored, NY);
      const demo = await runDemoParse(sample.raw, { viewerTimeZone: NY, ...(extractor ? { extractor } : { extractor: { extract: () => Promise.resolve({ ...EMPTY_EXTRACTION }) } }) });
      expect(live, id).toEqual(demo);
    }
  });

  it("没有解析结论的信：只出现在邮件列表，带上原因", () => {
    const r = notParsedResult("你发出的邮件", "这是你自己写的回复");
    expect(r.destination).toBe("dropped");
    expect(r.dedupKey).toBeNull();
    expect(r.trace[0]).toEqual({ label: "你发出的邮件", value: "忽略", reason: "这是你自己写的回复" });
  });
});

describe("记住公司的时区", () => {
  it("记住、覆盖、忘掉", () => {
    let e = rememberCompanyZone(EMPTY_EDITS, "云帆科技", "Asia/Shanghai");
    expect(e.companyZones).toEqual({ 云帆科技: "Asia/Shanghai" });
    expect(hasEdits(e)).toBe(true);
    e = rememberCompanyZone(e, "云帆科技", "America/New_York");
    expect(e.companyZones["云帆科技"]).toBe("America/New_York");
    e = forgetCompanyZone(e, "云帆科技");
    expect(e.companyZones).toEqual({});
    expect(hasEdits(e)).toBe(false);
  });

  it("公司名为空或时区不合法时不记", () => {
    expect(rememberCompanyZone(EMPTY_EDITS, "  ", "Asia/Shanghai")).toBe(EMPTY_EDITS);
    expect(rememberCompanyZone(EMPTY_EDITS, "云帆科技", "Beijing")).toBe(EMPTY_EDITS);
    expect(rememberCompanyZone(EMPTY_EDITS, "云帆科技", "Mars/Olympus")).toBe(EMPTY_EDITS);
  });

  it("时区名校验", () => {
    expect(isTimeZone("Asia/Shanghai")).toBe(true);
    expect(isTimeZone("UTC")).toBe(false);
    expect(isTimeZone(3)).toBe(false);
  });

  it("存取时坏的条目丢掉", () => {
    const parsed = parseEdits({ version: 1, companyZones: { 云帆科技: "Asia/Shanghai", 坏: "Nope/Zone", "": "Asia/Tokyo", 数字: 5 } });
    expect(parsed.companyZones).toEqual({ 云帆科技: "Asia/Shanghai" });
    expect(parseEdits({ version: 1, companyZones: "x" }).companyZones).toEqual({});
  });
});

describe("时区未知的场次：预填信里写的时间", () => {
  it("找到了日期与钟点但不知道时区：不上日程，但留下墙上时间给你确认时用", async () => {
    const result = await runDemoParse(
      {
        id: "u1",
        from: "云帆科技招聘 <ehr@service.yunfan.example>",
        to: "",
        subject: "【云帆科技】笔试通知",
        body: "同学你好，\n笔试时间：2026-10-21 10:00-2026-10-21 12:00\n请提前15分钟登录。",
        receivedAtUtc: "2026-10-12T04:00:00.000Z",
      },
      { viewerTimeZone: "Asia/Shanghai" },
    );
    expect(result.destination).toBe("pending");
    expect(result.when).toBeNull();
    expect(result.unzoned).toEqual({ local: "2026-10-21T10:00", kind: "fixed_start" });
    expect(notParsedResult("x", "y").unzoned).toBeNull();
  });
});
