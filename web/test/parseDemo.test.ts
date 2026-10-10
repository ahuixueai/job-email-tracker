import { describe, expect, it } from "vitest";
import { buildSampleEmails, cnMonthDay, enDate, isoMinute } from "@/lib/demo/sampleEmails";
import {
  collectAccess,
  displayRole,
  formatWallClock,
  kindLabelOf,
  runDemoParse,
  timeSummary,
  zoneLabel,
} from "@/lib/demo/parseDemo";
import { highlightSegments, locate } from "@/lib/demo/highlight";
import {
  buildAgenda,
  buildMonth,
  calendarItems,
  dateKeyIn,
  groupByDate,
  shiftMonth,
} from "@/lib/demo/agenda";
import type { DemoResult } from "@/lib/demo/parseDemo";
import {
  detokenize,
  EMPTY_RECORDING,
  hasRecording,
  parseRecording,
  RecordedExtractor,
  tokenize,
} from "@/lib/demo/recorded";
import type { Recording } from "@/lib/demo/recorded";
import { EMPTY_EXTRACTION, toCleanEmail } from "@/lib/tracker-core/index";
import shipped from "@/lib/demo/recordedExtractions.json";

// 2026-10-09 23:20 北京时间
const NOW = Date.parse("2026-10-09T15:20:00.000Z");
const DAY = 86_400_000;
const samples = buildSampleEmails(NOW);
const byId = (id: string) => {
  const found = samples.find((s) => s.id === id);
  if (!found) throw new Error(`没有样本 ${id}`);
  return found;
};
const parse = (id: string): Promise<DemoResult> =>
  runDemoParse(byId(id).raw, { viewerTimeZone: "America/New_York" });

describe("日期排版", () => {
  it("中文月日不补零", () => {
    expect(cnMonthDay(Date.parse("2026-03-04T02:00:00Z"))).toBe("3月4日");
  });

  it("按指定时区取日期，跨日不串", () => {
    // UTC 20:00 在上海已经是第二天
    expect(cnMonthDay(Date.parse("2026-10-09T20:00:00Z"))).toBe("10月10日");
    expect(enDate(Date.parse("2026-10-09T20:00:00Z"), "UTC")).toBe("9 October 2026");
  });

  it("落款时刻带补零，零点不写成 24 点", () => {
    expect(isoMinute(Date.parse("2026-10-09T16:05:00Z"))).toBe("2026-10-10 00:05");
  });

  it("墙上时间：月日 + 星期 + 24 小时制", () => {
    expect(formatWallClock("2026-10-14T11:00:00.000Z", "Asia/Shanghai")).toBe("10月14日 周三 19:00");
    expect(formatWallClock("2026-10-14T16:00:00.000Z", "Asia/Shanghai")).toBe("10月15日 周四 00:00");
  });
});

describe("合成样本", () => {
  it("id 唯一，且全部使用保留的 .example 域名", () => {
    expect(new Set(samples.map((s) => s.id)).size).toBe(samples.length);
    for (const s of samples) {
      expect(s.raw.from, s.id).toMatch(/@[a-z0-9-]+\.example>$/);
      expect(s.raw.id).toBe(s.id);
    }
  });

  it("每个占位符的文本都真的出现在正文里", () => {
    for (const s of samples) {
      for (const text of Object.values(s.tokens)) expect(s.raw.body, s.id).toContain(text);
    }
  });
});

describe("解析结论（只用规则）", () => {
  it("固定场次：开考时刻按北京时间换算，对纽约是当天早上", async () => {
    const r = await parse("fixed-exam");
    expect(r.eventType).toBe("assessment");
    expect(r.dueType).toBe("fixed_start");
    expect(r.timeZone).toBe("Asia/Shanghai");
    expect(r.when?.utc).toBe("2026-10-14T11:00:00.000Z");
    expect(r.when?.source).toBe("10月14日 周三 19:00");
    expect(r.when?.viewer).toBe("10月14日 周三 07:00");
    expect(r.when?.sameZone).toBe(false);
    expect(r.destination).toBe("board");
  });

  it("相对期限：从收信时刻起算 72 小时", async () => {
    const r = await parse("relative-deadline");
    expect(r.dueType).toBe("deadline");
    expect(r.when?.utc).toBe(new Date(NOW + 3 * DAY).toISOString());
  });

  it("签发时刻不当场次：结论是 3 天后的期限，不是收信那一刻", async () => {
    const r = await parse("issuance-trap");
    expect(r.dueType).toBe("deadline");
    expect(r.when?.utc).toBe(new Date(NOW + 3 * DAY).toISOString());
  });

  it("英文邮件、香港面试：时区来自 HKT，不因为是英文就推成美国", async () => {
    const r = await parse("english-hk");
    expect(r.eventType).toBe("interview");
    expect(r.dueType).toBe("fixed_start");
    expect(r.timeZone).toBe("Asia/Hong_Kong");
    expect(r.when?.utc).toBe("2026-10-17T06:00:00.000Z");
  });

  it("没有时区线索：不给时刻、不进主看板", async () => {
    const r = await parse("no-timezone");
    expect(r.timeZone).toBeNull();
    expect(r.when).toBeNull();
    expect(r.destination).toBe("pending");
    expect(r.trace.find((t) => t.label === "哪个时区")?.value).toBe("不确定");
    // 信里其实写了钟点，定不下来是因为时区未知——理由必须如实说，不能概括成「没写几点」
    expect(r.dueReason).toContain("时区未知");
  });

  it("投递回执：没有时间是正常的", async () => {
    const r = await parse("application-ok");
    expect(r.eventType).toBe("application_ok");
    expect(r.dueType).toBe("unknown");
    expect(r.when).toBeNull();
  });

  it("验证码在预筛被丢弃，并说得出为什么", async () => {
    const r = await parse("noise");
    expect(r.destination).toBe("dropped");
    expect(r.dedupKey).toBeNull();
    expect(r.extraction).toBeNull();
    expect(r.trace).toHaveLength(1);
    expect(r.trace[0]?.reason).toContain("验证码");
  });

  it("观察者与事件同一时区时标记 sameZone", async () => {
    const r = await runDemoParse(byId("fixed-exam").raw, { viewerTimeZone: "Asia/Shanghai" });
    expect(r.when?.sameZone).toBe(true);
  });

  it("每一步都带依据", async () => {
    const r = await parse("fixed-exam");
    expect(r.trace.map((t) => t.label)).toEqual([
      "第一道筛选",
      "公司",
      "什么事",
      "什么形式",
      "哪个时区",
      "时间性质",
    ]);
    for (const step of r.trace) expect(step.reason.length, step.label).toBeGreaterThan(0);
  });
});

/**
 * ⚠️ 下面这份是**测试夹具**，手写的，用来验证回放机制本身。
 * 它不是模型的真实输出，也不进演示站——演示站只读 recordedExtractions.json。
 */
const FIXTURE: Recording = {
  model: "fixture-model",
  recordedOn: "2026-10-09",
  extractions: {
    "fixed-exam": {
      ...EMPTY_EXTRACTION,
      companyRaw: "星河科技",
      roleRaw: "商业分析师",
      timeText: "考试时间：{{EXAM_DAY}} 19:00-20:40（北京时间）",
      eventTypeHint: "assessment",
    },
    reminder: {
      ...EMPTY_EXTRACTION,
      companyRaw: "星河科技",
      timeText: "{{EXAM_DAY}} 19:00（北京时间）开考",
      eventTypeHint: "reminder",
    },
  },
};

describe("录制与回放", () => {
  it("tokenize 与 detokenize 互逆", () => {
    const tokens = byId("fixed-exam").tokens;
    const live = { ...EMPTY_EXTRACTION, timeText: `考试时间：${tokens.EXAM_DAY} 19:00` };
    const stored = tokenize(live, tokens);
    expect(stored.timeText).toBe("考试时间：{{EXAM_DAY}} 19:00");
    expect(detokenize(stored, tokens)).toEqual(live);
  });

  it("不认识的占位名原样保留，交给接地检查去挡", () => {
    const out = detokenize({ ...EMPTY_EXTRACTION, timeText: "{{NOPE}} 10:00" }, {});
    expect(out.timeText).toBe("{{NOPE}} 10:00");
  });

  it("换一天打开，回放的片段仍然对得上当天生成的正文", async () => {
    const later = buildSampleEmails(NOW + 40 * DAY);
    const sample = later.find((s) => s.id === "fixed-exam");
    if (!sample) throw new Error("缺样本");
    const r = await runDemoParse(sample.raw, {
      viewerTimeZone: "Asia/Shanghai",
      extractor: new RecordedExtractor(FIXTURE, sample.tokens),
    });
    expect(r.extraction?.timeText).toContain(sample.tokens.EXAM_DAY);
    expect(r.dueType).toBe("fixed_start");
    expect(r.when?.utc).toBe("2026-11-23T11:00:00.000Z");
  });

  it("公司名摘对之后，催办与原通知落在同一个识别键上", async () => {
    const run = (id: string) =>
      runDemoParse(byId(id).raw, {
        viewerTimeZone: "Asia/Shanghai",
        extractor: new RecordedExtractor(FIXTURE, byId(id).tokens),
      });
    const [exam, reminder] = await Promise.all([run("fixed-exam"), run("reminder")]);
    // 只用规则时催办的公司名会被标题正则摘成「提醒」，两封信对不上
    const ruleOnly = await parse("reminder");
    expect(ruleOnly.company).not.toBe(exam.company);

    expect(reminder.company).toBe(exam.company);
    expect(reminder.dedupKey).toBe(exam.dedupKey);
  });

  it("没录过的样本退回桩抽取器", async () => {
    const sample = byId("english-hk");
    const extractor = new RecordedExtractor(FIXTURE, sample.tokens);
    await expect(extractor.extract(toCleanEmail(sample.raw))).resolves.toMatchObject({
      timeText: null,
    });
    expect(hasRecording(FIXTURE, "english-hk")).toBe(false);
    expect(hasRecording(FIXTURE, "fixed-exam")).toBe(true);
    expect(hasRecording(EMPTY_RECORDING, "fixed-exam")).toBe(false);
  });

  it.each([null, 42, "x", {}, { extractions: null }, { extractions: "x" }])(
    "形状不对的录制文件收敛成空：%j",
    (value) => {
      expect(parseRecording(value)).toEqual(EMPTY_RECORDING);
    },
  );

  it("逐条收敛脏字段，不因一条坏记录废掉整份", () => {
    const r = parseRecording({
      model: "m",
      recordedOn: 20261009,
      extractions: {
        good: { companyRaw: "星河科技", timeText: "", notJobRelated: true, eventTypeHint: "interview" },
        bad: "not an object",
      },
    });
    expect(r.model).toBe("m");
    expect(r.recordedOn).toBeNull();
    expect(Object.keys(r.extractions)).toEqual(["good"]);
    expect(r.extractions.good).toEqual({
      ...EMPTY_EXTRACTION,
      companyRaw: "星河科技",
      eventTypeHint: "interview",
      notJobRelated: true,
    });
  });

  /**
   * 下面两条跑的是仓库里随附的**真实录制**（模型的实际输出），不是上面的手写夹具。
   * 重新录制后如果模型摘坏了，演示站上「模型」那一栏就会退步——这两条负责拦住。
   * 录制文件为空时跳过。
   */
  const real = parseRecording(shipped);
  const withReal = (id: string) =>
    runDemoParse(byId(id).raw, {
      viewerTimeZone: "Asia/Shanghai",
      extractor: new RecordedExtractor(real, byId(id).tokens),
    });

  it.skipIf(real.model === null)("真实录制：催办并入原笔试通知", async () => {
    const [exam, reminder] = await Promise.all([withReal("fixed-exam"), withReal("reminder")]);
    expect(reminder.dedupKey).toBe(exam.dedupKey);
  });

  it.skipIf(real.model === null)("真实录制：片段都过得了接地检查，时间结论与只用规则时一致", async () => {
    for (const s of samples) {
      // 被预筛忽略的、以及还没录制过的样本不在这条的范围内
      if (s.id === "noise" || !hasRecording(real, s.id)) continue;
      const [rule, model] = await Promise.all([parse(s.id), withReal(s.id)]);
      const recorded = real.extractions[s.id];
      // 录下来有时间片段的，回放后不该被接地检查丢掉
      if (recorded?.timeText) expect(model.extraction?.timeText, s.id).not.toBeNull();
      expect(model.company.length, s.id).toBeGreaterThan(0);
      // 模型只改变「摘到了什么」，不该改变时间上的任何结论
      expect(model.dueType, s.id).toBe(rule.dueType);
      expect(model.when?.utc, s.id).toBe(rule.when?.utc);
      expect(model.timeZone, s.id).toBe(rule.timeZone);
    }
  });

  it("仓库里随附的录制文件读得进来，且只包含已知样本", () => {
    const r = parseRecording(shipped);
    const known = new Set(samples.map((s) => s.id));
    for (const id of Object.keys(r.extractions)) expect(known.has(id), id).toBe(true);
  });
});

describe("形式分类与叫法", () => {
  it.each([
    ["fixed-exam", "笔试"],
    ["relative-deadline", "在线测评"],
    ["issuance-trap", "在线测评"],
    ["english-hk", "视频面试"],
    ["phone-interview", "电话面试"],
    ["ai-interview", "AI 面试"],
    ["no-timezone", "面试（形式未说明）"],
    ["application-ok", "投递成功"],
  ])("%s → %s", async (id, label) => {
    expect((await parse(id)).kindLabel).toBe(label);
  });

  it("AI 面试是限期完成，不是准点开始", async () => {
    const r = await parse("ai-interview");
    expect(r.format).toBe("ai_interview");
    expect(r.dueType).toBe("deadline");
    expect(r.when?.source).toMatch(/23:59$/);
  });

  it("电话面试是准点开始", async () => {
    const r = await parse("phone-interview");
    expect(r.dueType).toBe("fixed_start");
    expect(r.when?.source).toMatch(/15:30$/);
  });

  it("说不出形式时退回事件类型", () => {
    expect(kindLabelOf("interview", "unspecified")).toBe("面试（形式未说明）");
    expect(kindLabelOf("result", "not_applicable")).toBe("结果通知");
    expect(kindLabelOf("interview", "phone_interview")).toBe("电话面试");
  });

  it("时区用中文叫法，表里没有的退回城市名", () => {
    expect(zoneLabel("Asia/Shanghai")).toBe("北京时间");
    expect(zoneLabel("America/New_York")).toBe("纽约时间");
    expect(zoneLabel("Europe/Paris")).toBe("Paris 时间");
    expect(zoneLabel("America/Sao_Paulo")).toBe("Sao Paulo 时间");
  });

  it("展示用原名，合并用归一名", async () => {
    const sample = byId("fixed-exam");
    const r = await runDemoParse(sample.raw, {
      viewerTimeZone: "Asia/Shanghai",
      extractor: new RecordedExtractor(FIXTURE, sample.tokens),
    });
    expect(r.displayCompany).toBe("星河科技");
    expect(r.company).not.toBe(r.displayCompany);
    expect(r.role).toBe("商业分析师");
  });
});

describe("原文高亮", () => {
  const body = "考试时间：10月14日 19:00（北京时间）\n地点 深圳，岗位 商业分析师";

  it("全角半角、空白不同也找得到，且高亮的是原文里真实的那一段", () => {
    const hit = locate(body, "考试时间:10月14日19:00");
    expect(hit).not.toBeNull();
    expect(body.slice(hit?.[0], hit?.[1])).toBe("考试时间：10月14日 19:00");
  });

  it("找不到或空片段返回 null", () => {
    expect(locate(body, "9月1日")).toBeNull();
    expect(locate(body, "   ")).toBeNull();
  });

  it("切成片段后拼回去等于原文", () => {
    const segments = highlightSegments(body, [
      { kind: "role", fragment: "商业分析师" },
      { kind: "time", fragment: "10月14日 19:00" },
      { kind: "location", fragment: "深圳" },
      { kind: "company", fragment: null },
    ]);
    expect(segments.map((s) => s.text).join("")).toBe(body);
    expect(segments.filter((s) => s.kind !== null).map((s) => [s.kind, s.text])).toEqual([
      ["time", "10月14日 19:00"],
      ["location", "深圳"],
      ["role", "商业分析师"],
    ]);
  });

  it("重叠时时间优先，另一个放弃", () => {
    const segments = highlightSegments("10月14日 星河科技笔试", [
      { kind: "company", fragment: "14日 星河" },
      { kind: "time", fragment: "10月14日" },
    ]);
    expect(segments.filter((s) => s.kind !== null)).toEqual([{ kind: "time", text: "10月14日" }]);
  });

  it("没有任何标记时整段原样返回", () => {
    expect(highlightSegments("abc", [])).toEqual([{ text: "abc", kind: null }]);
    expect(highlightSegments("", [])).toEqual([]);
  });

  it("片段在原文末尾", () => {
    const segments = highlightSegments("岗位 分析师", [{ kind: "role", fragment: "分析师" }]);
    expect(segments).toEqual([
      { text: "岗位 ", kind: null },
      { text: "分析师", kind: "role" },
    ]);
  });
});

describe("日程与日历", () => {
  const entriesWith = async (ids: readonly string[], fixture = true) =>
    Promise.all(
      ids.map(async (id) => ({
        sampleId: id,
        subject: byId(id).raw.subject,
        result: await runDemoParse(byId(id).raw, {
          viewerTimeZone: "America/New_York",
          ...(fixture ? { extractor: new RecordedExtractor(FIXTURE, byId(id).tokens) } : {}),
        }),
      })),
    );

  it("同一件事的两封邮件折叠成一条，并记下来源", async () => {
    const agenda = buildAgenda(await entriesWith(["fixed-exam", "reminder", "noise"]));
    expect(agenda).toHaveLength(1);
    expect(agenda[0]?.sources.map((s) => s.sampleId)).toEqual(["fixed-exam", "reminder"]);
  });

  it("有时刻的按先后排在前面，没有时刻的排在后面", async () => {
    const agenda = buildAgenda(
      await entriesWith(["application-ok", "fixed-exam", "no-timezone", "phone-interview"], false),
    );
    expect(agenda.map((item) => item.sources[0]?.sampleId)).toEqual([
      "phone-interview",
      "fixed-exam",
      "application-ok",
      "no-timezone",
    ]);
  });

  it("日历只画已排进日程且时刻可换算的事", async () => {
    const agenda = buildAgenda(await entriesWith(["fixed-exam", "no-timezone", "application-ok"]));
    expect(calendarItems(agenda).map((item) => item.sources[0]?.sampleId)).toEqual(["fixed-exam"]);
  });

  it("按看的人所在时区落格：同一时刻在两地可以不是同一天", () => {
    // 北京 10月15日 08:00 = 纽约 10月14日 20:00
    expect(dateKeyIn("2026-10-15T00:00:00.000Z", "Asia/Shanghai")).toBe("2026-10-15");
    expect(dateKeyIn("2026-10-15T00:00:00.000Z", "America/New_York")).toBe("2026-10-14");
  });

  it("groupByDate 用观察者时区分组", async () => {
    const agenda = buildAgenda(await entriesWith(["fixed-exam", "reminder"]));
    // 北京 10月14日 19:00 = 纽约 10月14日 07:00
    expect([...groupByDate(agenda, "America/New_York").keys()]).toEqual(["2026-10-14"]);
    expect(groupByDate(agenda, "America/New_York").get("2026-10-14")).toHaveLength(1);
  });

  it("月历网格：周一开头，整周补齐", () => {
    const oct = buildMonth(2026, 10); // 2026-10-01 是周四
    expect(oct.weeks.every((week) => week.length === 7)).toBe(true);
    expect(oct.weeks[0]?.map((d) => d.day)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    expect(oct.weeks[0]?.[0]).toEqual({ dateKey: "2026-09-28", day: 28, inMonth: false });
    expect(oct.weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
    expect(oct.weeks.flat().at(-1)?.dateKey).toBe("2026-11-01");
  });

  it("月历网格：闰年二月与恰好四周的月份", () => {
    expect(buildMonth(2028, 2).weeks.flat().filter((d) => d.inMonth)).toHaveLength(29);
    // 2027-02-01 是周一，28 天，正好 4 周不用补
    const feb = buildMonth(2027, 2);
    expect(feb.weeks).toHaveLength(4);
    expect(feb.weeks.flat().every((d) => d.inMonth)).toBe(true);
  });

  it("翻月处理跨年", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 10, 0)).toEqual({ year: 2026, month: 10 });
  });
});

describe("卡片上的时间", () => {
  it("按看的人所在时区显示，并说明是哪里的时间", async () => {
    // 北京 10月14日 19:00 开考，纽约是当天早上 7 点
    expect(timeSummary(await parse("fixed-exam"), "America/New_York")).toEqual({
      text: "10月14日 周三 07:00",
      zone: "纽约时间",
    });
  });

  it("截止期限带「前」字，和准点开始区分开", async () => {
    const t = timeSummary(await parse("ai-interview"), "America/New_York");
    expect(t.text).toMatch(/ 前$/);
    expect(timeSummary(await parse("phone-interview"), "America/New_York").text).not.toMatch(/前$/);
  });

  it("拿不准的写「时间待确认」，本来就没有时间的写「没有具体时间」", async () => {
    expect(timeSummary(await parse("no-timezone"), "America/New_York")).toEqual({
      text: "时间待确认",
      zone: null,
    });
    const receipt = await runDemoParse(byId("application-ok").raw, {
      viewerTimeZone: "America/New_York",
      extractor: new RecordedExtractor(
        { ...FIXTURE, extractions: { "application-ok": { ...EMPTY_EXTRACTION, companyRaw: "云帆物流" } } },
        {},
      ),
    });
    expect(receipt.destination).toBe("board");
    expect(timeSummary(receipt, "America/New_York")).toEqual({ text: "没有具体时间", zone: null });
  });
});

describe("入口链接与密钥", () => {
  it("测评邀请：链接与密钥逐字摘出", async () => {
    const r = await parse("relative-deadline");
    expect(r.links).toEqual(["https://assess.beichen-consulting.example/a/7f3k2"]);
    expect(r.credentials).toEqual([{ label: "测评密钥", value: "BC-7Q2M-91XK" }]);
  });

  it("视频面试：会议链接、会议号、入会密码", async () => {
    const r = await parse("english-hk");
    expect(r.links).toEqual(["https://meet.aurorapacific.example/j/gp-interview"]);
    expect(r.credentials).toEqual([
      { label: "Meeting ID", value: "882 134 507" },
      { label: "Passcode", value: "60417" },
    ]);
  });

  it("信里没有就是空的，不编", async () => {
    const r = await parse("phone-interview");
    expect(r.links).toEqual([]);
    expect(r.credentials).toEqual([]);
  });

  it("被忽略的验证码邮件：那串数字不当成凭据", async () => {
    const r = await parse("noise");
    expect(r.credentials).toEqual([]);
  });

  it("加了链接和密钥之后，时间上的结论没有被带偏", async () => {
    expect((await parse("fixed-exam")).when?.utc).toBe("2026-10-14T11:00:00.000Z");
    expect((await parse("english-hk")).when?.utc).toBe("2026-10-17T06:00:00.000Z");
    expect((await parse("relative-deadline")).when?.utc).toBe(new Date(NOW + 3 * DAY).toISOString());
  });

  it("合并的事取并集：催办信里没有密钥，仍能从原通知拿到", async () => {
    const [exam, reminder] = await Promise.all([parse("fixed-exam"), parse("reminder")]);
    expect(reminder.credentials).toEqual([]);
    expect(collectAccess([exam, reminder, undefined, exam])).toEqual({
      links: ["https://exam.xinghe-tech.example/s/ba-kq7"],
      credentials: [{ label: "考试码", value: "XHKJ-7Q4M" }],
    });
  });
});

describe("岗位名的展示", () => {
  it("岗位里重复的公司名去掉开头那一处", () => {
    expect(displayRole("云帆物流 2027 届管理培训生", "云帆物流")).toBe("2027 届管理培训生");
    expect(displayRole("星河科技-商业分析师", "星河科技")).toBe("商业分析师");
  });

  it("不以公司名开头的原样返回", () => {
    expect(displayRole("商业分析师", "星河科技")).toBe("商业分析师");
    expect(displayRole("Analyst at Meridian Partners", "Meridian Partners")).toBe(
      "Analyst at Meridian Partners",
    );
  });

  it("去完什么都不剩、没有公司名、没有岗位：都不动", () => {
    expect(displayRole("星河科技", "星河科技")).toBe("星河科技");
    expect(displayRole("商业分析师", "")).toBe("商业分析师");
    expect(displayRole(null, "星河科技")).toBeNull();
  });
});

describe("英文邮件", () => {
  it("美国在线测评：月在前的日期、ET、夏令时", async () => {
    const r = await parse("us-assessment");
    expect(r.kindLabel).toBe("在线测评");
    expect(r.dueType).toBe("deadline");
    expect(r.timeZone).toBe("America/New_York");
    // 10月16日 23:59 ET，十月是夏令时（UTC-4）
    expect(r.when?.utc).toBe("2026-10-17T03:59:00.000Z");
    expect(r.links).toEqual(["https://assess.northwind-analytics.example/t/9k2"]);
    expect(r.credentials).toEqual([{ label: "Access code", value: "NW-48Q7-TZ" }]);
  });

  it("phone screen 认成电话面试，按太平洋时间换算", async () => {
    const r = await parse("us-phone-screen");
    expect(r.kindLabel).toBe("电话面试");
    expect(r.dueType).toBe("fixed_start");
    expect(r.timeZone).toBe("America/Los_Angeles");
    expect(r.when?.utc).toBe("2026-10-14T17:00:00.000Z");
    expect(timeSummary(r, "America/New_York").text).toBe("10月14日 周三 13:00");
  });

  it("拒信是结果通知，不是投递成功", async () => {
    const r = await parse("us-rejection");
    expect(r.eventType).toBe("result");
    expect(r.kindLabel).toBe("结果通知");
    expect(r.when).toBeNull();
  });
});
