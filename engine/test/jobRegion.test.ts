import { describe, expect, it } from "vitest";
import { StubExtractor } from "../src/extract.js";
import type { RawEmail } from "../src/rawEmail.js";
import { parseEmail } from "../src/pipeline.js";
import type { ParseOutcome } from "../src/pipeline.js";
import { inferTimeZone } from "../src/timezone.js";

/**
 * 求职地（第 5 优先级）：用户自己说「我在中国大陆找工作」，没写时区的信就按北京时间算。
 * 它只补空白，不覆盖任何一条更具体的线索。
 */

function mail(over: Partial<RawEmail> = {}): RawEmail {
  return {
    id: "mail-1",
    from: "hr@example-corp.net",
    to: "jobs@my.example",
    subject: "【星河科技】面试邀请",
    body: "面试定于 8月20日 14:00，请准时参加。",
    receivedAtUtc: "2026-08-11T13:34:00.000Z",
    ...over,
  };
}

function parsed(outcome: ParseOutcome) {
  if (outcome.kind !== "parsed") throw new Error(`期望解析成功，实际被丢弃：${outcome.reason}`);
  return outcome;
}

describe("inferTimeZone · 求职地", () => {
  it("没有任何线索时，用求职地，并写明依据", () => {
    const r = inferTimeZone({ text: "面试定于 8月20日 14:00", jobTimeZone: "Asia/Shanghai" });
    expect(r).toMatchObject({ tz: "Asia/Shanghai", source: "jobRegion", confidence: "medium" });
    expect(r.reason).toContain("求职地");
  });

  it("信里写明的时区压过求职地", () => {
    const r = inferTimeZone({ text: "面试时间 10:00（香港时间）", jobTimeZone: "Asia/Shanghai" });
    expect(r.tz).toBe("Asia/Hong_Kong");
    expect(r.source).toBe("explicit");
  });

  it("这家公司确认过的时区压过求职地", () => {
    const r = inferTimeZone({ text: "面试 14:00", knownCompanyRegion: "Asia/Singapore", jobTimeZone: "Asia/Shanghai" });
    expect(r.tz).toBe("Asia/Singapore");
    expect(r.source).toBe("ledger");
  });

  it("求职地不是合法时区名：当没设置", () => {
    expect(inferTimeZone({ text: "面试 14:00", jobTimeZone: "北京" }).tz).toBeNull();
    expect(inferTimeZone({ text: "面试 14:00", jobTimeZone: "Mars/Base" }).tz).toBeNull();
  });
});

describe("parseEmail · 求职地", () => {
  it("没设置求职地：时区未知，照旧不显示时刻", async () => {
    const out = parsed(await parseEmail(mail(), { extractor: new StubExtractor() }));
    expect(out.event.sourceTimeZone).toBeNull();
    expect(out.event.startUtc).toBeNull();
  });

  it("设置了中国大陆：按北京时间换算出时刻", async () => {
    const out = parsed(await parseEmail(mail(), { extractor: new StubExtractor(), jobTimeZone: "Asia/Shanghai" }));
    expect(out.event.sourceTimeZone).toBe("Asia/Shanghai");
    expect(out.event.dueType).toBe("fixed_start");
    expect(out.event.startUtc).toBe("2026-08-20T06:00:00.000Z");
    expect(out.trace.tz.source).toBe("jobRegion");
  });

  it("信里写了别的时区：不受求职地影响", async () => {
    const out = parsed(
      await parseEmail(mail({ body: "面试定于 8月20日 14:00（新加坡时间），请准时参加。" }), {
        extractor: new StubExtractor(),
        jobTimeZone: "Asia/Shanghai",
      }),
    );
    expect(out.event.sourceTimeZone).toBe("Asia/Singapore");
    expect(out.event.startUtc).toBe("2026-08-20T06:00:00.000Z");
    expect(out.trace.tz.source).toBe("explicit");
  });
});
