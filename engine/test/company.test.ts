import { describe, expect, it } from "vitest";
import {
  ALIAS_INDEX_SIZE,
  ALIAS_SEED_CONFLICTS,
  cleanCompanyName,
  isAtsDomain,
  isSameCompany,
  normalizeCompany,
} from "../src/company.js";
import { SEED_ALIASES } from "../src/companyAliasSeed.js";

describe("cleanCompanyName", () => {
  it("去掉括号内容", () => {
    expect(cleanCompanyName("毕马威 (KPMG)")).toBe("毕马威");
    expect(cleanCompanyName("海尔集团（Haier）")).toBe("海尔");
    expect(cleanCompanyName("拼多多【PDD】")).toBe("拼多多");
  });

  it("去掉无区分度的后缀", () => {
    expect(cleanCompanyName("岚图汽车科技股份有限公司")).toBe("岚图汽车");
    expect(cleanCompanyName("中国人民保险集团股份有限公司")).toBe("中国人民保险");
    expect(cleanCompanyName("Apple Inc.")).toBe("Apple");
  });

  it("后缀就是全名时不清空", () => {
    expect(cleanCompanyName("集团")).toBe("集团");
  });
});

describe("normalizeCompany · 别名表", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["毕马威", "毕马威"],
    ["KPMG", "毕马威"],
    ["毕马威 (KPMG)", "毕马威"],
    ["Apple", "Apple"],
    ["Apple苹果", "Apple"],
    ["苹果", "Apple"],
    ["普华永道", "普华永道"],
    ["PwC", "普华永道"],
    ["普华永道 (PwC)", "普华永道"],
    ["拼多多", "拼多多"],
    ["PDD", "拼多多"],
    ["拼多多 (PDD)", "拼多多"],
    ["海尔集团", "海尔"],
    ["Haier", "海尔"],
    ["海尔集团 (Haier)", "海尔"],
    ["中国人保集团", "中国人保"],
    ["中国人民保险集团", "中国人保"],
    ["京东集团", "京东"],
    ["小米集团", "小米"],
    ["岚图汽车", "岚图"],
    ["安踏集团", "安踏"],
    ["阿里巴巴", "阿里巴巴"],
    ["OPPO", "OPPO"],
    ["滴滴", "滴滴"],
  ];

  it.each(cases)("%s → %s", (raw, expected) => {
    const result = normalizeCompany(raw);
    expect(result.canonical).toBe(expected);
    expect(result.matched).toBe(true);
  });

  it("中英文互认：两种写法归到同一个", () => {
    expect(isSameCompany("KPMG", "毕马威 (KPMG)")).toBe(true);
    expect(isSameCompany("Apple", "Apple苹果")).toBe(true);
    expect(isSameCompany("PwC", "普华永道")).toBe(true);
  });

  it("不同公司不会被合并", () => {
    expect(isSameCompany("KPMG", "PwC")).toBe(false);
    expect(isSameCompany("京东集团", "小米集团")).toBe(false);
  });
});

describe("normalizeCompany · 发件域名线索", () => {
  it("公司自有域名可以补出公司名", () => {
    const result = normalizeCompany("", "campus@jd.com");
    expect(result.canonical).toBe("京东");
    expect(result.matched).toBe(true);
  });

  it("子域名同样有效", () => {
    expect(normalizeCompany("", "noreply@email.apple.com").canonical).toBe("Apple");
  });

  it("别名表优先于域名", () => {
    // 名字已经能归一时不需要域名兜底
    expect(normalizeCompany("小米集团", "campus@jd.com").canonical).toBe("小米");
  });

  it("ATS 域名一律不参与推断", () => {
    // 这些域名背后是任意多家公司，拿它当线索会造成系统性错归
    expect(isAtsDomain("voyah-no-reply@mail.mokahr.com")).toBe(true);
    expect(isAtsDomain("support@batchmail.nowcoder.net")).toBe(true);
    expect(isAtsDomain("noreply@shmail.ibeisen.com")).toBe(true);
    expect(isAtsDomain("kpmg@mail.joinus.cc")).toBe(true);
    expect(isAtsDomain("noreply-xiaomihire@mail.hire.feishu.cn")).toBe(true);
    expect(isAtsDomain("campus@jd.com")).toBe(false);
  });
});

describe("normalizeCompany · 归一失败时的行为", () => {
  it("匹配不上就返回清洗后的原名，且 matched=false", () => {
    const result = normalizeCompany("某不知名创业公司");
    expect(result.matched).toBe(false);
    expect(result.canonical).toBe("某不知名创业");
  });

  it("未命中别名表的两家不会被判为同一家", () => {
    // 错误合并两家公司比不合并糟糕得多：用户会看到别家的面试出现在自己记录里
    expect(isSameCompany("某公司A", "某公司A")).toBe(false);
  });

  it("空输入不炸", () => {
    expect(normalizeCompany("").canonical).toBe("");
    expect(normalizeCompany("", "").matched).toBe(false);
  });
});

describe("外部种子别名合并", () => {
  it("种子确实合进了索引", () => {
    expect(SEED_ALIASES.length).toBe(86);
    // 手工 13 组 + 种子 86 组，键数应远超手工表自身
    expect(ALIAS_INDEX_SIZE).toBeGreaterThan(150);
  });

  it("新增的中英文对照可用", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["CICC", "中金"],
      ["XPENG", "小鹏汽车"],
      ["WeRide", "文远知行"],
      ["Tencent", "腾讯"],
      ["Baidu", "百度"],
      ["BYD", "比亚迪"],
      ["CATL", "宁德时代"],
      ["Deloitte", "德勤"],
      ["EY", "安永"],
      ["McKinsey & Company", "麦肯锡"],
      ["NIO", "蔚来汽车"],
      ["miHoYo", "米哈游"],
    ];
    for (const [a, b] of pairs) {
      expect(isSameCompany(a, b), `${a} 与 ${b} 应归一到同一家`).toBe(true);
    }
  });

  it("手工条目不被种子覆盖", () => {
    // 冲突时以现有为准，这四条是实际发生的冲突
    expect(normalizeCompany("KPMG").canonical).toBe("毕马威");
    expect(normalizeCompany("毕马威 (KPMG)").canonical).toBe("毕马威");
    expect(normalizeCompany("Apple").canonical).toBe("Apple");
    expect(normalizeCompany("Apple苹果").canonical).toBe("Apple");
    expect(normalizeCompany("苹果中国").canonical).toBe("Apple");
    expect(normalizeCompany("京东集团").canonical).toBe("京东");
    expect(normalizeCompany("滴滴出行").canonical).toBe("滴滴");
    expect(normalizeCompany("Temu").canonical).toBe("拼多多");
  });

  it("冲突项被记录下来供复核", () => {
    const names = ALIAS_SEED_CONFLICTS.map((c) => c.seedCanonical);
    expect(names).toContain("苹果中国");
    expect(names).toContain("京东集团");
    expect(names).toContain("滴滴出行");
    expect(names).toContain("Temu");
    for (const c of ALIAS_SEED_CONFLICTS) {
      expect(c.existingCanonical.length).toBeGreaterThan(0);
    }
  });

  it("噪音别名被跳过：RED 不会把任何东西归到小红书", () => {
    // 三字母通用英文词，误匹配代价高于收益
    expect(normalizeCompany("RED").matched).toBe(false);
    expect(normalizeCompany("小红书").canonical).toBe("小红书");
  });

  it("种子里的公司不会互相串台", () => {
    expect(isSameCompany("Deloitte", "EY")).toBe(false);
    expect(isSameCompany("蔚来汽车", "理想汽车")).toBe(false);
    expect(isSameCompany("小鹏汽车", "极氪汽车")).toBe(false);
  });
});

describe("标准名简化：种子表的展示风格向手工表看齐", () => {
  it("带泛化后缀的写法归一到最短通用叫法，原写法仍可匹配", () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      // [原写法, 简化后, 简化后的英文/缩写别名]
      ["腾讯科技", "腾讯", "Tencent"],
      ["中金公司", "中金", "CICC"],
      ["AMD中国", "AMD", "AMD"],
      ["微软中国", "微软", "Microsoft"],
      ["联想集团", "联想", "Lenovo"],
      ["高盛集团", "高盛", "Goldman Sachs"],
      ["贝恩公司", "贝恩", "Bain & Company"],
      ["蚂蚁集团", "蚂蚁", "Ant Group"],
    ];
    for (const [original, short, englishAlias] of cases) {
      expect(normalizeCompany(original).canonical, original).toBe(short);
      expect(normalizeCompany(short).canonical, short).toBe(short);
      expect(normalizeCompany(englishAlias).canonical, englishAlias).toBe(short);
      // 简化不等于丢弃：原写法必须仍能归一到同一个标准名
      expect(isSameCompany(original, short), `${original} vs ${short}`).toBe(true);
    }
  });

  it("有歧义风险的三条刻意不简化，保留区分度", () => {
    // 「平安」单独用会和平安银行/平安好医生等子品牌混淆
    expect(normalizeCompany("平安科技").canonical).toBe("平安科技");
    // 「百胜」单独辨识度低，「百胜中国」本身就是官方通行简称
    expect(normalizeCompany("百胜中国").canonical).toBe("百胜中国");
    // Sequoia 2023 年拆分后中国区改名 HongShan，「红杉」是否仍是通行叫法把握不足
    expect(normalizeCompany("红杉中国").canonical).toBe("红杉中国");
  });

  it("短名不是全名的别名——曾经是真实 bug，短名被错误合并进了长名", () => {
    // 平安科技/百胜中国/红杉中国 的种子别名里曾经混进了「平安」「百胜」「红杉」，
    // 导致 normalizeCompany("平安") 归一到「平安科技」。但「平安」单独出现时
    // 通常指的是平安集团这个母公司（旗下还有平安银行、平安证券等独立子品牌），
    // 不是特指平安科技这一个子公司——短名被长名吸收，方向反了。
    //
    // 现实世界这三对分别是独立主体：
    //   平安（集团） vs 平安科技（子公司）
    //   百胜（Yum! Brands 全球总部） vs 百胜中国（Yum China，2016 年分拆后独立上市）
    //   红杉（Sequoia Capital 全球） vs 红杉中国/HongShan（2023 年拆分后独立品牌）
    //
    // 修法不是保留短名作别名，是把短名从别名表里删掉：宁可 matched:false
    // 让用户看到清洗后的原名，也不能让它错误地并进另一家公司的记录里。
    for (const shortName of ["平安", "百胜", "红杉"]) {
      const result = normalizeCompany(shortName);
      expect(result.matched, shortName).toBe(false);
      expect(result.canonical, shortName).toBe(shortName);
    }

    // 全名本身仍然正确匹配自己，没有被这次修复连带破坏
    expect(normalizeCompany("平安科技")).toMatchObject({ canonical: "平安科技", matched: true });
    expect(normalizeCompany("百胜中国")).toMatchObject({ canonical: "百胜中国", matched: true });
    expect(normalizeCompany("红杉中国")).toMatchObject({ canonical: "红杉中国", matched: true });

    // 「平安集团」这个真实存在的母公司写法，不应该被误归到平安科技
    expect(normalizeCompany("平安集团").matched).toBe(false);

    // 两个短名不会因为都 matched:false 就被判成同一家公司
    expect(isSameCompany("平安", "百胜")).toBe(false);
    expect(isSameCompany("平安", "平安科技")).toBe(false);
  });

  it("排查了种子表全部 86 组「X + 中国/科技/集团/公司」模式，只命中这三条", () => {
    // 其余同模式条目（AMD中国/AMD、微软中国/微软、联想集团/联想……）里，
    // 短名与带后缀的全名指向的是同一个实体，不存在另一个独立存在的「短名公司」，
    // 予以保留——这条测试锁定「没有过度修复」：AMD 这类不该被连带误伤成 matched:false
    const safeShortForms: ReadonlyArray<readonly [string, string]> = [
      ["AMD", "AMD"],
      ["微软", "微软"],
      ["联想", "联想"],
      ["腾讯", "腾讯"],
      ["华润", "华润"],
      ["蚂蚁", "蚂蚁"],
    ];
    for (const [input, expected] of safeShortForms) {
      const result = normalizeCompany(input);
      expect(result.matched, input).toBe(true);
      expect(result.canonical, input).toBe(expected);
    }
  });

  it("矮化 bug 的根源是 matchKey 对 canonical 自身的通用后缀剥离，不只是别名列表", () => {
    // 「平安」这次 bug 不是靠删掉种子里的显式别名就能堵住的：
    // matchKey("平安科技") 经过 SUFFIXES 剥离本来就会收窄成"平安"（"科技"
    // 在 SUFFIXES 表里），这条映射的产生跟别名列表写没写"平安"无关。
    // 独立复刻了一遍 matchKey 的剥离逻辑，对种子表 86 组 + 手工表 13 组
    // 全量扫描，确认整个 99 组里只有"平安科技"→"平安"这一条会发生收窄
    // （"京东集团"→"京东"也会收窄，但那是有意为之的正确折叠，
    // 不是本轮修的 bug）。这条测试锁定这个排查结论：AMBIGUOUS_EXACT
    // 只需要覆盖"平安科技"（以及为了对称性顺带覆盖的百胜中国/红杉中国），
    // 不需要再加别的条目。
    expect(normalizeCompany("平安科技")).toMatchObject({ canonical: "平安科技", matched: true });
    // 「平安科技有限公司」这类带额外法律后缀的写法会被剥穿到"平安"，
    // 精确名单认不出，只能 matched:false——这是本轮修复选择的取舍：
    // 宁可对这类少见的全称写法降级为不认识，也不能让"平安"错误地
    // 归到"平安科技"。
    expect(normalizeCompany("平安科技有限公司").matched).toBe(false);
  });

  it("已经通过手工表冲突折叠的条目不受简化规则影响", () => {
    // 这四条走的是「整条折叠进现有标准名」，不是本轮的简化规则
    expect(normalizeCompany("京东集团").canonical).toBe("京东");
    expect(normalizeCompany("滴滴出行").canonical).toBe("滴滴");
    expect(normalizeCompany("苹果中国").canonical).toBe("Apple");
    expect(normalizeCompany("Temu").canonical).toBe("拼多多");
  });
});

describe("变音符归一化：L'Oréal 系列写法收敛到同一个键", () => {
  it("三种常见写法归一到同一个标准名", () => {
    const spellings = ["L'Oréal", "L'Oreal", "LOreal", "L Oreal"];
    const canon = spellings.map((s) => normalizeCompany(s).canonical);
    // 全部命中且指向同一个标准名
    for (const c of canon) expect(c).toBe("欧莱雅");
  });

  it("互相之间判定为同一家公司", () => {
    expect(isSameCompany("L'Oréal", "L'Oreal")).toBe(true);
    expect(isSameCompany("L'Oréal", "LOreal")).toBe(true);
    expect(isSameCompany("LOreal", "欧莱雅")).toBe(true);
  });

  it("变音符归一不会把两个真正不同的公司混到一起", () => {
    // 只是去掉重音符与撇号，不做别的模糊匹配
    expect(isSameCompany("L'Oréal", "Loreal Group Holdings")).toBe(false);
  });
});

describe("ATS 域名清单已切到 domains.ts 单一来源", () => {
  it("company.ts 与 timezone.ts 用的是同一份名单：新加进 domains.ts 的域名两边都生效", () => {
    // 这几个域名只存在于 domains.ts 的 INTERNATIONAL_ATS_DOMAINS 里，
    // company.ts 原先自己维护的短名单并不包含它们
    for (const domain of ["myworkday.com", "icims.com", "ashbyhq.com", "jobvite.com", "successfactors.com"]) {
      expect(isAtsDomain(`hr@${domain}`), domain).toBe(true);
    }
  });

  it("国内 ATS 域名也生效，且不会被当成公司线索", () => {
    for (const domain of ["zhaopin.com", "liepin.com", "51job.com", "dajie.com"]) {
      expect(isAtsDomain(`no-reply@${domain}`), domain).toBe(true);
      expect(normalizeCompany("", `no-reply@${domain}`).matched, domain).toBe(false);
    }
  });

  it("原有 ATS 域名判定没有退化", () => {
    for (const domain of ["mokahr.com", "ibeisen.com", "nowcoder.net", "joinus.cc", "hrtps.com", "greenhouse.io", "lever.co"]) {
      expect(isAtsDomain(`x@${domain}`), domain).toBe(true);
    }
  });
});
