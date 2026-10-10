import { join } from "node:path";
import { NextResponse } from "next/server";
import { buildLedgerInterviews, LIVE_STATUS, type LedgerAppRow } from "@/lib/ledgerInterviews";
import { DEMO_MODE } from "@/lib/demoMode";

/**
 * GET /api/interviews
 *
 * 直读本机的 ~/jobhunt/ledger.db，把「在推进且有时间节点」的记录变成看板卡片。
 * 选取条件与 scripts/export_ics.py 的 SQL 完全一致——日历导出的事件数和这里
 * 返回的条数必须对得上，否则用户会以为两边哪个算错了。
 *
 * 同 /api/funnel：库不在、列没建、读不动，都返回一个能让界面把话说清楚的结构，
 * 不抛 500。这个路由也只在本机有意义（阶段 A 全程本机跑）。
 *
 * **demo 模式**：看板在 demo 下由 `mocks/interviews.ts` 在客户端注入
 * （见 InterviewBoard 里的 `if (seedDemo) return;`），本路由不参与。
 * 这里仍然短路返回，是为了不让演示站把服务器上的文件路径写进错误信息。
 */
export const dynamic = "force-dynamic";

const DB_PATH = join(process.cwd(), "..", "ledger.db");

const SQL = `
  SELECT id, company, role, region, status, next_due, deadline, next_action
  FROM applications
  WHERE status IN (${LIVE_STATUS.map(() => "?").join(",")})
    AND (COALESCE(TRIM(next_due), '') <> '' OR COALESCE(TRIM(deadline), '') <> '')
  ORDER BY company
`;

export async function GET(): Promise<NextResponse> {
  if (DEMO_MODE) {
    return NextResponse.json({
      ok: true,
      source: "demo",
      generatedAt: new Date().toISOString(),
      interviews: [],
      note: "演示站的看板数据由客户端 mocks/interviews.ts 注入，本路由不参与",
    });
  }

  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return NextResponse.json(
      { ok: false, error: "当前 Node 没有 node:sqlite（需要 Node 22+）" },
      { status: 501 },
    );
  }

  let db: InstanceType<typeof DatabaseSync> | null = null;
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
    const rows = db.prepare(SQL).all(...LIVE_STATUS) as unknown as LedgerAppRow[];
    const now = Date.now();
    return NextResponse.json({
      ok: true,
      source: DB_PATH,
      generatedAt: new Date(now).toISOString(),
      interviews: buildLedgerInterviews(rows, { now }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 最常见的两种：库不在（还没建台账）、列不存在（迁移没跑）。
    // 两种都让界面直说缺什么，而不是给用户一个 500。
    const hint = /no such column/i.test(message)
      ? "台账还没跑阶段字段迁移：python3 scripts/migrate_stage_fields.py"
      : /unable to open|no such file/i.test(message)
        ? `读不到 ${DB_PATH}`
        : undefined;
    return NextResponse.json({ ok: false, error: message, hint }, { status: 503 });
  } finally {
    db?.close();
  }
}
