import { describe, expect, test, vi } from "vitest";
import * as R from "@/store/reducers";
import { mergeVisibleOrder, newId, orderInterviews } from "@/store/reducers";
import { CAL, NOW, hoursFromNow, makeBoard, makeInterview } from "./helpers";

/**
 * 排序契约：manualOrder 为 false 时，order 必须始终是当前优先级的真实反映；
 * 为 true 时，用户的顺序高于一切，任何改动都不许动它。
 */
describe("updateInterview 与自动排序", () => {
  test("改时间使其变紧急时，自动排序下要重新冒到前面", () => {
    const board = makeBoard([
      makeInterview({ id: "近", startUtc: hoursFromNow(10) }),
      makeInterview({ id: "远", startUtc: hoursFromNow(24 * 30) }),
    ]);

    const next = R.updateInterview(board, "远", { startUtc: hoursFromNow(1) }, NOW);

    expect(next.order).toEqual(["远", "近"]);
  });

  test("改重要度后，自动排序下要重新排", () => {
    // 两张卡都在一个月开外，紧急度同为最低，差别只在重要度
    const board = makeBoard(
      [
        makeInterview({ id: "冷门", importance: 1, startUtc: hoursFromNow(24 * 30) }),
        makeInterview({ id: "梦中情司", importance: 5, startUtc: hoursFromNow(24 * 31) }),
      ],
      { order: ["梦中情司", "冷门"] },
    );

    const next = R.updateInterview(board, "冷门", { importance: 5 }, NOW);

    // 同为 5 分后按开始时间升序兜底，「冷门」更早，翻到第一
    expect(next.order).toEqual(["冷门", "梦中情司"]);
  });

  test("手动排过序后，改字段不许动用户的顺序", () => {
    const board = makeBoard(
      [
        makeInterview({ id: "近", startUtc: hoursFromNow(10) }),
        makeInterview({ id: "远", startUtc: hoursFromNow(24 * 30) }),
      ],
      { order: ["远", "近"], manualOrder: true },
    );

    const next = R.updateInterview(board, "远", { startUtc: hoursFromNow(1) }, NOW);

    expect(next.order).toBeUndefined();
  });

  test("改的字段与优先级无关时不重排", () => {
    const board = makeBoard([
      makeInterview({ id: "A" }),
      makeInterview({ id: "B" }),
    ]);

    const next = R.updateInterview(board, "B", { location: "深圳" }, NOW);

    expect(next.order).toBeUndefined();
  });
});

describe("setStatus", () => {
  test("标为 offer 后要沉到底", () => {
    const board = makeBoard([
      makeInterview({ id: "A", startUtc: hoursFromNow(1) }),
      makeInterview({ id: "B", startUtc: hoursFromNow(48) }),
    ]);

    const next = R.setStatus(board, "A", "offer", NOW);

    expect(next.order).toEqual(["B", "A"]);
  });

  test("标为 rejected 后要沉到底", () => {
    const board = makeBoard([
      makeInterview({ id: "A", startUtc: hoursFromNow(1) }),
      makeInterview({ id: "B", startUtc: hoursFromNow(48) }),
    ]);

    const next = R.setStatus(board, "A", "rejected", NOW);

    expect(next.order).toEqual(["B", "A"]);
  });

  test("手动排序下标为 offer 也不动顺序", () => {
    const board = makeBoard(
      [
        makeInterview({ id: "A", startUtc: hoursFromNow(1) }),
        makeInterview({ id: "B", startUtc: hoursFromNow(48) }),
      ],
      { manualOrder: true },
    );

    expect(R.setStatus(board, "A", "offer", NOW).order).toBeUndefined();
  });
});

describe("addInterview", () => {
  test("自动排序下新卡按优先级插到正确位置，不是追加到末尾", () => {
    const board = makeBoard([
      makeInterview({ id: "远", startUtc: hoursFromNow(24 * 30) }),
    ]);

    const next = R.addInterview(
      board,
      makeInterview({ id: "急", startUtc: hoursFromNow(2) }),
      NOW,
    );

    expect(next.order).toEqual(["急", "远"]);
  });

  test("手动排序下新卡追加到末尾", () => {
    const board = makeBoard(
      [makeInterview({ id: "远", startUtc: hoursFromNow(24 * 30) })],
      { manualOrder: true },
    );

    const next = R.addInterview(
      board,
      makeInterview({ id: "急", startUtc: hoursFromNow(2) }),
      NOW,
    );

    expect(next.order).toEqual(["远", "急"]);
  });

  /**
   * 把系统挂钟拨到与传入的 now 相差一个月的位置。
   * 若实现内部偷偷读了 Date.now()，两张卡的紧急度分档会互换，顺序就会反过来。
   */
  test("排序只认传入的 now，不读系统挂钟", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(NOW - 24 * 30 * 3_600_000));

      // 低重要度但 10 小时后就开始：按 NOW 算是最紧急（分数 85）
      const 明早 = makeInterview({
        id: "明早",
        importance: 1,
        startUtc: hoursFromNow(10),
      });
      // 高重要度但 20 天后：分数 65。挂钟视角下「明早」还有一个月，反而排在它后面
      const 高价值 = makeInterview({
        id: "高价值",
        importance: 5,
        startUtc: hoursFromNow(24 * 20),
      });

      const next = R.addInterview(makeBoard([高价值]), 明早, NOW);

      expect(next.order).toEqual(["明早", "高价值"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("removeInterview", () => {
  test("同时从 interviews、order 和折叠静默期里清掉", () => {
    const board = makeBoard(
      [makeInterview({ id: "a" }), makeInterview({ id: "b" })],
      { prepSnoozeUntil: { a: 123, b: 456 } },
    );

    const next = R.removeInterview(board, "a");

    expect(next.interviews?.map((i) => i.id)).toEqual(["b"]);
    expect(next.order).toEqual(["b"]);
    expect(next.prepSnoozeUntil).toEqual({ b: 456 });
  });
});

describe("nudge", () => {
  const board = makeBoard([
    makeInterview({ id: "a" }),
    makeInterview({ id: "b" }),
    makeInterview({ id: "c" }),
  ]);

  test("上移一位并锁定手动排序", () => {
    const next = R.nudge(board, "b", -1);
    expect(next?.order).toEqual(["b", "a", "c"]);
    expect(next?.manualOrder).toBe(true);
  });

  test("下移一位", () => {
    expect(R.nudge(board, "b", 1)?.order).toEqual(["a", "c", "b"]);
  });

  test("已在头尾时返回 null，不做无意义的写入", () => {
    expect(R.nudge(board, "a", -1)).toBeNull();
    expect(R.nudge(board, "c", 1)).toBeNull();
  });

  test("id 不在 order 里返回 null", () => {
    expect(R.nudge(board, "不存在", 1)).toBeNull();
  });
});

describe("deleteSubCalendar", () => {
  const CAL_2 = { id: "cal-2", name: "春招", color: "#ffc93c", description: null };
  const board = makeBoard(
    [
      makeInterview({ id: "a", subCalendarId: "cal-1" }),
      makeInterview({ id: "b", subCalendarId: "cal-2" }),
    ],
    { subCalendars: [CAL, CAL_2], filterCalendarId: "cal-2" },
  );

  test("migrate：名下面试改挂到目标日历，一条不丢", () => {
    const next = R.deleteSubCalendar(board, "cal-2", {
      kind: "migrate",
      targetId: "cal-1",
    });

    expect(next.interviews?.map((i) => i.subCalendarId)).toEqual(["cal-1", "cal-1"]);
    expect(next.order).toEqual(["a", "b"]);
  });

  test("purge：名下面试一并删除，order 同步清干净", () => {
    const next = R.deleteSubCalendar(board, "cal-2", { kind: "purge" });

    expect(next.interviews?.map((i) => i.id)).toEqual(["a"]);
    expect(next.order).toEqual(["a"]);
  });

  test("被删的日历正在筛选中时，筛选退回全部", () => {
    expect(R.deleteSubCalendar(board, "cal-2", { kind: "purge" }).filterCalendarId).toBeNull();
  });

  test("删的不是当前筛选的日历时，筛选保持不动", () => {
    expect(
      R.deleteSubCalendar(board, "cal-1", { kind: "purge" }).filterCalendarId,
    ).toBe("cal-2");
  });
});

describe("mergeVisibleOrder", () => {
  /** 筛选视图下拖拽：Reorder 只知道可见的那几张，隐藏项必须留在原本的绝对位置。 */
  test("隐藏项不动，可见项按新顺序回填", () => {
    expect(mergeVisibleOrder(["a", "隐藏", "b", "c"], ["c", "a", "b"])).toEqual([
      "c",
      "隐藏",
      "a",
      "b",
    ]);
  });

  test("全部可见时等同于直接替换", () => {
    expect(mergeVisibleOrder(["a", "b"], ["b", "a"])).toEqual(["b", "a"]);
  });

  test("没有可见项时原样返回", () => {
    expect(mergeVisibleOrder(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

describe("orderInterviews", () => {
  test("按 order 取出，并过滤掉 order 里的脏 id", () => {
    const items = [makeInterview({ id: "a" }), makeInterview({ id: "b" })];
    expect(
      orderInterviews(items, ["b", "早就删了的", "a"]).map((i) => i.id),
    ).toEqual(["b", "a"]);
  });

  test("order 里没提到的面试不会出现", () => {
    const items = [makeInterview({ id: "a" }), makeInterview({ id: "b" })];
    expect(orderInterviews(items, ["a"]).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("newId", () => {
  test("带前缀且每次不同", () => {
    const a = newId("itv");
    const b = newId("itv");
    expect(a.startsWith("itv-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
