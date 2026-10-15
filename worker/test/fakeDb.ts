import type { D1Database, D1PreparedStatement } from "../src/types.js";

/**
 * 内存里的假 D1：只认本项目用到的那几条语句，遇到没模拟的语句直接报错——
 * 这样代码里新加一条 SQL 却忘了测，测试会立刻失败，而不是悄悄返回空。
 */
export function fakeDb() {
  const emails: Record<string, unknown>[] = [];
  const notices: Record<string, unknown>[] = [];
  const settings = new Map<string, { value: string; updated_at: string }>();
  const loginFailures: { ip: string; at: string }[] = [];
  const users: { id: string; email: string; role: string; calendar_token: string | null; created_at: string }[] = [];
  const loginCodes = new Map<
    string,
    { code_hash: string | null; expires_at: string | null; attempts: number; last_sent_at: string; window_start: string; window_sends: number }
  >();
  const loginSends: { ip: string; at: string }[] = [];
  const pick = <T extends object>(row: T | undefined, keys: readonly string[]) =>
    row ? (Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k]])) as Record<string, unknown>) : null;

  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      const q = query.replace(/\s+/g, " ").trim();
      let args: unknown[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first<T>() {
          if (q.startsWith("SELECT id FROM emails WHERE message_id")) {
            return (emails.find((e) => e.message_id === args[0]) ?? null) as T | null;
          }
          const getKey = /^SELECT value(, updated_at)? FROM settings WHERE key = '(\w+)'$/.exec(q);
          if (getKey) {
            const row = settings.get(getKey[2] ?? "");
            return (row ? (getKey[1] ? row : { value: row.value }) : null) as T | null;
          }
          const userCols = ["id", "email", "role", "calendar_token"];
          if (q === "SELECT id, email, role, calendar_token FROM users WHERE id = ?") return pick(users.find((u) => u.id === args[0]), userCols) as T | null;
          if (q === "SELECT id, email, role, calendar_token FROM users WHERE email = ?") return pick(users.find((u) => u.email === args[0]), userCols) as T | null;
          if (q === "SELECT id, email, role, calendar_token FROM users WHERE calendar_token = ?") {
            return pick(users.find((u) => u.calendar_token === args[0]), userCols) as T | null;
          }
          if (q === "SELECT last_sent_at, window_start, window_sends FROM login_codes WHERE email = ?") {
            return pick(loginCodes.get(args[0] as string), ["last_sent_at", "window_start", "window_sends"]) as T | null;
          }
          if (q === "SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?") {
            return pick(loginCodes.get(args[0] as string), ["code_hash", "expires_at", "attempts"]) as T | null;
          }
          if (q.startsWith("SELECT COUNT(*) AS n FROM login_sends")) {
            const [ip, since] = args as [string, string];
            return { n: loginSends.filter((f) => f.ip === ip && f.at > since).length } as T;
          }
          if (q.startsWith("SELECT COUNT(*) AS n FROM login_failures")) {
            const [ip, since] = args as [string, string];
            return { n: loginFailures.filter((f) => f.ip === ip && f.at > since).length } as T;
          }
          throw new Error(`没有模拟这条查询：${q}`);
        },
        async run() {
          if (q.startsWith("INSERT INTO notices")) {
            const [id, kind, received_at, subject, body] = args;
            notices.push({ id, kind, received_at, subject, body });
          } else if (q.startsWith("INSERT INTO emails")) {
            const keys = ["id", "message_id", "received_at", "stored_at", "via", "from_addr", "subject", "body", "status", "outcome", "model", "error"];
            emails.push(Object.fromEntries(keys.map((k, i) => [k, args[i]])));
          } else if (q.startsWith("INSERT INTO users")) {
            const [id, email, role, calendar_token, created_at] = args as [string, string, string, string | null, string];
            if (!users.some((u) => u.email === email)) users.push({ id, email, role, calendar_token, created_at });
          } else if (q === "UPDATE users SET calendar_token = ? WHERE id = ?") {
            const u = users.find((x) => x.id === args[1]);
            if (u) u.calendar_token = args[0] as string;
          } else if (q.startsWith("INSERT INTO login_codes")) {
            const [email, code_hash, expires_at, last_sent_at, window_start, window_sends] = args as [string, string | null, string | null, string, string, number];
            loginCodes.set(email, { code_hash, expires_at, attempts: 0, last_sent_at, window_start, window_sends });
          } else if (q === "UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?") {
            const r = loginCodes.get(args[0] as string);
            if (r) r.attempts += 1;
          } else if (q === "UPDATE login_codes SET code_hash = NULL, expires_at = NULL WHERE email = ?") {
            const r = loginCodes.get(args[0] as string);
            if (r) Object.assign(r, { code_hash: null, expires_at: null });
          } else if (q.startsWith("INSERT INTO login_sends")) {
            const [ip, at] = args as [string, string];
            loginSends.push({ ip, at });
          } else if (q.startsWith("INSERT INTO login_failures")) {
            const [ip, at] = args as [string, string];
            loginFailures.push({ ip, at });
          } else if (/^INSERT INTO settings \(key, value, updated_at\) VALUES \('(\w+)'/.test(q)) {
            const key = /VALUES \('(\w+)'/.exec(q)?.[1] ?? "";
            const [value, updated_at] = args as [string, string];
            settings.set(key, { value, updated_at });
          } else if (/^DELETE FROM settings WHERE key = '(\w+)'$/.test(q)) {
            settings.delete(/key = '(\w+)'/.exec(q)?.[1] ?? "");
          } else if (q.startsWith("DELETE FROM emails WHERE id = ?")) {
            const i = emails.findIndex((e) => e.id === args[0]);
            if (i >= 0) emails.splice(i, 1);
          } else if (q.startsWith("UPDATE emails SET outcome = ?, status = ? WHERE id = ?")) {
            const [outcome, status, id] = args as [string, string, string];
            const row = emails.find((e) => e.id === id);
            if (row) Object.assign(row, { outcome, status });
          } else {
            throw new Error(`没有模拟这条语句：${q}`);
          }
          return { results: [], success: true };
        },
        async all<T>() {
          if (q.startsWith("SELECT id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error FROM emails")) {
            const rows = [...emails].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
            return { results: rows as T[], success: true };
          }
          if (q.startsWith("SELECT id, from_addr, subject, body, received_at, status, outcome FROM emails WHERE status = 'parsed' AND id > ?")) {
            const [after, limit] = args as [string, number];
            const rows = emails
              .filter((e) => e.status === "parsed" && String(e.id) > after)
              .sort((a, b) => String(a.id).localeCompare(String(b.id)))
              .slice(0, limit);
            return { results: rows as T[], success: true };
          }
          if (q.startsWith("SELECT id, kind, received_at, subject, body FROM notices")) {
            const rows = [...notices].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
            return { results: rows.slice(0, 5) as T[], success: true };
          }
          throw new Error(`没有模拟这条查询：${q}`);
        },
      };
      return stmt;
    },
  };
  return { db, emails, notices, settings, loginFailures, users, loginCodes, loginSends };
}
