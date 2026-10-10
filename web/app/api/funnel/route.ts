import { join } from "node:path";
import { NextResponse } from "next/server";
import { computeFunnel, type LedgerRow } from "@/lib/funnel";
import { DEMO_MODE } from "@/lib/demoMode";
import { demoLedgerRows } from "@/lib/demoLedger";

/**
 * GET /api/funnel
 *
 * 直读本机的 ~/jobhunt/ledger.db，算出漏斗数字。**不建服务端、不加依赖**：
 * 用 Node 22 自带的 node:sqlite，只读打开，任何情况下不写台账。
 *
 * 阶段 A 全程在本机跑，这个路由也只在本机有意义——
 * 库不在、列没建、读不动，都返回一个能让界面把话说清楚的结构，不抛 500。
 *
 * **demo 模式例外**：演示站上根本不该有台账文件，所以连试都不试，
 * 直接用假行走一遍同一个 computeFunnel()。**不去碰文件系统，也就不会把
 * 服务器上的路径写进错误信息里。**
 */
export const dynamic = "force-dynamic";

const DB_PATH = join(process.cwd(), "..", "ledger.db");

const SQL = `
  SELECT id, status, applied_at, oa_at, interview_at,
         closed_at, outcome, first_response_at
  FROM applications
`;

export async function GET(): Promise<NextResponse> {
  if (DEMO_MODE) {
    return NextResponse.json({
      ok: true,
      source: "demo",
      generatedAt: new Date().toISOString(),
      funnel: computeFunnel(demoLedgerRows()),
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
    const rows = db.prepare(SQL).all() as unknown as LedgerRow[];
    return NextResponse.json({
      ok: true,
      source: DB_PATH,
      generatedAt: new Date().toISOString(),
      funnel: computeFunnel(rows),
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
