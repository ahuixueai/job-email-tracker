/**
 * node:sqlite 的最小类型声明。
 *
 * Node 22 运行时自带这个模块，但仓库里的 @types/node 是 ^20，没有它的类型。
 * 与其为了几行类型去升 @types/node（会牵动整个类型面），不如在这里
 * 只声明本项目真正用到的那几个成员——零依赖变更，改动面也小。
 *
 * ⚠️ 这是手写的窄声明，不是官方类型。用到新成员时要在这里补，
 * 补的时候对着 Node 文档写，别凭印象。
 */
declare module "node:sqlite" {
  interface DatabaseSyncOptions {
    readOnly?: boolean;
    open?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  interface StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
