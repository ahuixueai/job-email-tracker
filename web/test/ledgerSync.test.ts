import { describe, expect, test } from "vitest";
import * as R from "@/store/reducers";
import { NOW, hoursFromNow, makeBoard, makeInterview } from "./helpers";

/**
 * ledger.db → 看板的**持续同步**契约。
 *
 * 之前 `importInterviews` 只增不减：台账改了时间、或记录被关掉，
 * 已经落进 localStorage 的卡片不会跟着变，也不会消失（8/20 登记的已知限制）。
 *
 * 这里钉死的是三件事：
 * 1. ledger 拥有的字段以台账为准，每次刷新；
 * 2. 台账里不再出现的记录，卡片要消失；
 * 3. **用户拥有的字段（滑动改的状态、重要度、备战信息）一律不许盖回去**——
 *    `buildLedgerInterviews` 里 `status: "scheduled"` / `importance: 3` 是常量占位，
 *    不是台账数据，拿它去覆盖等于把用户的操作抹掉（CLAUDE.md 铁律三）。
 */

/** 造一条「/api/interviews 返回的」台账卡片。externalId 是同步的唯一匹配键。 */
function ledgerItem(patch: Partial<ReturnType<typeof makeInterview>> & { id: string }) {
  return makeInterview({
    source: "ledger",
    externalId: patch.id,
    subCalendarId: "cal-ledger",
    ...patch,
  });
}

/** 造一张「已经同步进 store 的」台账卡片：本地 id 与 externalId 不同，和线上一致。 */
function storedLedgerCard(
  externalId: string,
  patch: Partial<ReturnType<typeof makeInterview>> = {},
) {
  return makeInterview({
    id: `itv-${externalId}`,
    source: "ledger",
    externalId,
    subCalendarId: "cal-ledger",
    ...patch,
  });
}

describe("syncLedgerInterviews", () => {
  test("台账改了时间，已有卡片跟着更新，不新增第二张", () => {
    const board = makeBoard([
      storedLedgerCard("ledger-60", { startUtc: hoursFromNow(24) }),
    ]);

    const next = R.syncLedgerInterviews(
      board,
      [ledgerItem({ id: "ledger-60", startUtc: hoursFromNow(48), endUtc: hoursFromNow(49) })],
      NOW,
    );

    expect(next.interviews).toHaveLength(1);
    expect(next.interviews![0].id).toBe("itv-ledger-60");
    expect(next.interviews![0].startUtc).toBe(hoursFromNow(48));
  });

  test("台账里不再出现的记录，卡片要消失", () => {
    const board = makeBoard([
      storedLedgerCard("ledger-60"),
      storedLedgerCard("ledger-61"),
    ]);

    const next = R.syncLedgerInterviews(board, [ledgerItem({ id: "ledger-60" })], NOW);

    expect(next.interviews!.map((i) => i.externalId)).toEqual(["ledger-60"]);
    expect(next.order).not.toContain("itv-ledger-61");
  });

  test("消失的卡片要把折叠静默期一起带走，免得 id 复用时沿用旧时间戳", () => {
    const board = makeBoard([storedLedgerCard("ledger-61")], {
      prepSnoozeUntil: { "itv-ledger-61": NOW + 1000 },
    });

    const next = R.syncLedgerInterviews(board, [], NOW);

    expect(next.prepSnoozeUntil).toEqual({});
  });

  test("手动新建的卡片不受台账同步影响", () => {
    const board = makeBoard([
      makeInterview({ id: "手工", source: "manual", externalId: null }),
      storedLedgerCard("ledger-60"),
    ]);

    const next = R.syncLedgerInterviews(board, [], NOW);

    expect(next.interviews!.map((i) => i.id)).toEqual(["手工"]);
  });

  test("用户改过的状态和重要度，不许被台账的常量占位盖回去", () => {
    const board = makeBoard([
      storedLedgerCard("ledger-60", { status: "rejected", importance: 5 }),
    ]);

    // buildLedgerInterviews 永远吐 status:"scheduled" / importance:3
    const next = R.syncLedgerInterviews(
      board,
      [ledgerItem({ id: "ledger-60", status: "scheduled", importance: 3 })],
      NOW,
    );

    expect(next.interviews![0].status).toBe("rejected");
    expect(next.interviews![0].importance).toBe(5);
  });

  test("用户填过的备战信息不许被台账覆盖", () => {
    const board = makeBoard([
      storedLedgerCard("ledger-60", {
        prep: { meetingUrl: "https://meeting", resumeUrl: null, jdNotes: "我写的", checklist: [] },
      }),
    ]);

    const next = R.syncLedgerInterviews(
      board,
      [ledgerItem({ id: "ledger-60", prep: { meetingUrl: null, resumeUrl: null, jdNotes: "台账的", checklist: [] } })],
      NOW,
    );

    expect(next.interviews![0].prep.meetingUrl).toBe("https://meeting");
    expect(next.interviews![0].prep.jdNotes).toBe("我写的");
  });

  test("台账新增的记录会变成新卡片", () => {
    const board = makeBoard([storedLedgerCard("ledger-60")]);

    const next = R.syncLedgerInterviews(
      board,
      [ledgerItem({ id: "ledger-60" }), ledgerItem({ id: "ledger-99", company: "新公司" })],
      NOW,
    );

    expect(next.interviews).toHaveLength(2);
    const added = next.interviews!.find((i) => i.externalId === "ledger-99")!;
    expect(added.company).toBe("新公司");
    expect(added.id).not.toBe("ledger-99");
    expect(next.order).toContain(added.id);
  });

  test("手动排过序时，保留用户顺序，新卡追加末尾，消失的从 order 剔除", () => {
    const board = makeBoard(
      [storedLedgerCard("ledger-60"), storedLedgerCard("ledger-61")],
      { order: ["itv-ledger-61", "itv-ledger-60"], manualOrder: true },
    );

    const next = R.syncLedgerInterviews(
      board,
      [ledgerItem({ id: "ledger-60" }), ledgerItem({ id: "ledger-99" })],
      NOW,
    );

    const addedId = next.interviews!.find((i) => i.externalId === "ledger-99")!.id;
    expect(next.order).toEqual(["itv-ledger-60", addedId]);
  });

  test("没有 externalId 的台账条目直接跳过，不会每次刷新都建一张新卡", () => {
    const board = makeBoard([]);

    const next = R.syncLedgerInterviews(
      board,
      [ledgerItem({ id: "x", externalId: null })],
      NOW,
    );

    expect(next.interviews).toEqual([]);
  });
});
