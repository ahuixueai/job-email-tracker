import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement } from "../src/types.js";

/**
 * 测试用的数据库：真的 SQLite（Node 自带），**跑的是 migrations/ 里真实的建表与迁移脚本**。
 * 比手写的假数据库可靠：SQL 写错、迁移脚本写错，测试当场就会失败。
 */
const MIGRATIONS = new URL("../migrations/", import.meta.url);

/** D1 的绑定值：undefined 当 NULL，布尔当 0/1。 */
function bindable(value: unknown): null | number | string | bigint | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string" || typeof value === "bigint" || value instanceof Uint8Array) return value;
  return String(value);
}

const plain = <T,>(row: unknown): T => ({ ...(row as object) }) as T;

export interface TestDb {
  db: D1Database;
  /** 直接执行一条 SQL（造数据、改数据用）。 */
  exec(sql: string, ...args: unknown[]): void;
  /** 查多行，返回普通对象。 */
  all<T = Record<string, unknown>>(sql: string, ...args: unknown[]): T[];
  /** 某个人的邮件，按插入顺序。 */
  emails(userId?: string): Record<string, unknown>[];
  /** 接着跑剩下的迁移脚本（从第 from 个开始，0 起算；测迁移本身用）。 */
  migrate(from: number): void;
}

/** upTo：只跑到第几个迁移脚本为止（测迁移本身用）。 */
export function testDb(upTo?: number): TestDb {
  const raw = new DatabaseSync(":memory:");
  const allFiles = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const run = (files: string[]) => {
    for (const file of files) raw.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  };
  run(allFiles.slice(0, upTo));

  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let args: ReturnType<typeof bindable>[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]) {
          args = values.map(bindable);
          return stmt;
        },
        async first<T>() {
          const row = raw.prepare(query).get(...args);
          return row === undefined ? null : plain<T>(row);
        },
        async all<T>() {
          return { results: raw.prepare(query).all(...args).map((r) => plain<T>(r)), success: true };
        },
        async run() {
          raw.prepare(query).run(...args);
          return { results: [], success: true };
        },
      };
      return stmt;
    },
  };

  const all = <T,>(sql: string, ...args: unknown[]) => raw.prepare(sql).all(...args.map(bindable)).map((r) => plain<T>(r));
  return {
    db,
    exec: (sql, ...args) => {
      raw.prepare(sql).run(...args.map(bindable));
    },
    all,
    emails: (userId) =>
      userId === undefined ? all("SELECT * FROM emails ORDER BY rowid") : all("SELECT * FROM emails WHERE user_id = ? ORDER BY rowid", userId),
    migrate: (from) => run(allFiles.slice(from)),
  };
}
