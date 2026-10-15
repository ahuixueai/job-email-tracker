-- 账号（第 1 期：邮箱验证码登录；多人就绪，但先只有作者一个账号）。

-- 用户。email 一律存小写。calendar_token 是这个人的日历订阅口令（每人一把，可以换）。
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  role           TEXT NOT NULL DEFAULT 'member',
  calendar_token TEXT UNIQUE,
  created_at     TEXT NOT NULL
);

-- 验证码。每个邮箱只有一行：最新那次发的码（只存哈希）、什么时候过期、已经试错几次。
-- 不在名单里的邮箱也记一行（不发信、没有码），这样「发得太频繁」的提示对谁都一样，外人试不出谁有账号。
CREATE TABLE login_codes (
  email        TEXT PRIMARY KEY,
  code_hash    TEXT,
  expires_at   TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_sends INTEGER NOT NULL DEFAULT 0
);

-- 每个来源（IP）发码的记录：一小时最多 20 次，防止有人拿你的发信额度刷别人的邮箱。
CREATE TABLE login_sends (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX login_sends_ip_at ON login_sends (ip, at);
