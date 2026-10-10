import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

/**
 * 公共入口的冒烟测试。下游只从 src/index.ts 导入，所以少导出一个符号
 * 就是一次真实的破坏——这个用例专门盯这件事，顺便也让 barrel 文件被覆盖到。
 */
describe("公共入口", () => {
  it("1.2 新增的管线能力全部导出", () => {
    for (const name of [
      "toCleanEmail",
      "prefilter",
      "validateExtraction",
      "StubExtractor",
      "composeConfidence",
      "parseEmail",
      "summarize",
      "InboxStore",
      "route",
    ]) {
      expect(api, `缺少导出：${name}`).toHaveProperty(name);
    }
  });

  it("1.1 的核心能力仍然可用", () => {
    for (const name of [
      "normalizeCompany",
      "classifyEventType",
      "classifyDue",
      "classifyDueFromSignals",
      "dedupKeyOf",
      "foldEvents",
      "inferTimeZone",
      "formatDual",
    ]) {
      expect(api, `缺少导出：${name}`).toHaveProperty(name);
    }
  });

  it("从入口直接跑一遍最小链路", async () => {
    const out = await api.parseEmail(
      {
        id: "m1",
        from: "campus@jd.com",
        to: "u@x.com",
        subject: "来自京东集团的笔试邀请",
        body: "笔试时间：8月15日 10:00（北京时间）。",
        receivedAtUtc: "2026-08-11T13:34:00.000Z",
      },
      { extractor: new api.StubExtractor() },
    );
    const store = new api.InboxStore();
    const result = store.ingest(out);
    expect(result.kind).toBe("created");
    expect(store.counts().board).toBe(1);
  });
});
