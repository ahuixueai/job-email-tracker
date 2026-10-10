import { describe, expect, test } from "vitest";
import {
  BACKUP_FORMAT,
  buildBackup,
  mergePayload,
  parseBackup,
} from "@/lib/backup";
import { CAL, makeInterview } from "./helpers";

function file(overrides: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-09-01T00:00:00.000Z",
    interviews: [makeInterview({ id: "itv-1" })],
    subCalendars: [CAL],
    order: ["itv-1"],
    manualOrder: false,
    ...overrides,
  };
}

describe("parseBackup 整份文件级校验", () => {
  test("不是对象直接拒", () => {
    expect(parseBackup("字符串").ok).toBe(false);
    expect(parseBackup([]).ok).toBe(false);
    expect(parseBackup(null).ok).toBe(false);
  });

  test("format 不认识就拒，不去猜", () => {
    const result = parseBackup(file({ format: "别的应用/backup" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不像本应用导出的");
  });

  test("版本比应用新时拒绝，而不是硬读", () => {
    const result = parseBackup(file({ version: 99 }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("99");
  });

  test("缺 interviews 或 subCalendars 字段就拒", () => {
    expect(parseBackup(file({ interviews: undefined })).ok).toBe(false);
    expect(parseBackup(file({ subCalendars: undefined })).ok).toBe(false);
  });
});

describe("parseBackup 逐条校验", () => {
  test("坏记录跳过并说明原因，好记录照常导入", () => {
    const result = parseBackup(
      file({
        interviews: [
          makeInterview({ id: "好" }),
          { id: "坏", company: "X", startUtc: "不是时间" },
        ],
        order: ["好", "坏"],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.payload?.interviews.map((i) => i.id)).toEqual(["好"]);
    expect(result.skipped.some((s) => s.includes("开始时间"))).toBe(true);
  });

  test("时区不是真的 IANA 名就跳过，不兜底成本机时区", () => {
    const result = parseBackup(
      file({
        interviews: [makeInterview({ id: "x", sourceTimeZone: "Asia/火星" })],
      }),
    );
    expect(result.payload?.interviews).toEqual([]);
    expect(result.skipped.some((s) => s.includes("IANA"))).toBe(true);
  });

  test("重要度越界跳过", () => {
    const result = parseBackup(
      file({ interviews: [makeInterview({ id: "x", importance: 9 as never })] }),
    );
    expect(result.payload?.interviews).toEqual([]);
    expect(result.skipped.some((s) => s.includes("重要度"))).toBe(true);
  });

  test("颜色不是 #RRGGBB 的子日历跳过", () => {
    const result = parseBackup(
      file({
        subCalendars: [{ ...CAL, color: "red; background:url(x)" }],
        interviews: [],
        order: [],
      }),
    );
    expect(result.payload?.subCalendars).toEqual([]);
    expect(result.skipped.some((s) => s.includes("#RRGGBB"))).toBe(true);
  });

  test("指向不存在的子日历时落到第一个日历并留痕", () => {
    const result = parseBackup(
      file({
        interviews: [makeInterview({ id: "x", subCalendarId: "cal-已删" })],
      }),
    );
    expect(result.payload?.interviews[0].subCalendarId).toBe(CAL.id);
    expect(result.skipped.some((s) => s.includes("原子日历不存在"))).toBe(true);
  });

  test("order 里的脏 id 被剔除，漏掉的 id 补到末尾", () => {
    const result = parseBackup(
      file({
        interviews: [makeInterview({ id: "a" }), makeInterview({ id: "b" })],
        order: ["b", "早就删了的"],
      }),
    );
    expect(result.payload?.order).toEqual(["b", "a"]);
  });

  test("会议链接是伪协议时清成 null，其余字段照常导入", () => {
    const result = parseBackup(
      file({
        interviews: [
          makeInterview({
            id: "x",
            company: "EvilCorp",
            prep: {
              meetingUrl: "javascript:fetch('/api/integrations/google/import')",
              resumeUrl: "https://example.com/cv.pdf",
              jdNotes: "笔记要留着",
              checklist: ["带简历"],
            },
          }),
        ],
      }),
    );

    const imported = result.payload?.interviews[0];
    expect(imported?.prep.meetingUrl).toBeNull();
    // 只清掉危险的那个字段，不因为一个坏链接把整条记录丢掉
    expect(imported?.prep.resumeUrl).toBe("https://example.com/cv.pdf");
    expect(imported?.prep.jdNotes).toBe("笔记要留着");
    expect(result.skipped.some((s) => s.includes("EvilCorp"))).toBe(true);
  });
});

describe("buildBackup 与 parseBackup 往返", () => {
  test("导出再导入，面试内容不变", () => {
    const original = makeInterview({ id: "itv-1", company: "字节跳动" });
    const built = buildBackup({
      interviews: [original],
      subCalendars: [CAL],
      order: ["itv-1"],
      manualOrder: true,
    });

    const result = parseBackup(JSON.parse(JSON.stringify(built)));

    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual([]);
    expect(result.payload?.interviews[0]).toEqual(original);
    expect(result.payload?.manualOrder).toBe(true);
  });
});

describe("mergePayload", () => {
  const base = {
    interviews: [makeInterview({ id: "a", company: "旧" })],
    subCalendars: [CAL],
    order: ["a"],
    manualOrder: false,
  };

  test("同 id 以导入的为准", () => {
    const merged = mergePayload(base, {
      ...base,
      interviews: [makeInterview({ id: "a", company: "新" })],
    });
    expect(merged.interviews).toHaveLength(1);
    expect(merged.interviews[0].company).toBe("新");
  });

  test("新 id 追加到 order 末尾", () => {
    const merged = mergePayload(base, {
      interviews: [makeInterview({ id: "b" })],
      subCalendars: [],
      order: ["b"],
      manualOrder: false,
    });
    expect(merged.order).toEqual(["a", "b"]);
  });

  test("order 里不留没有对应面试的 id", () => {
    const merged = mergePayload(
      { ...base, order: ["a", "幽灵"] },
      { interviews: [], subCalendars: [], order: [], manualOrder: false },
    );
    expect(merged.order).toEqual(["a"]);
  });

  test("任一侧是手动排序，合并后就是手动排序", () => {
    const merged = mergePayload(base, { ...base, manualOrder: true });
    expect(merged.manualOrder).toBe(true);
  });
});
