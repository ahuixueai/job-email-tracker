-- 多人版第 2 期：每个人的数据分开存。
-- 已有的邮件、提醒、看板操作、偏好、简历全部归到作者账号（role = 'owner'）名下。
-- 作者账号此时一般已经存在（登录过一次就有）；万一还没有，这些行先挂在空的 user_id 下，
-- 作者账号第一次建出来时会认领（accounts.ts 的 ensureOwner）。

-- 1. 邮件：加 user_id；「同一封信只存一次」改成每人各算各的（两个人可能都转发同一封群发信）。
--    SQLite 删不掉列上的 UNIQUE，只能重建表。
CREATE TABLE emails_v2 (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT '',
  message_id  TEXT,
  received_at TEXT NOT NULL,
  stored_at   TEXT NOT NULL,
  via         TEXT NOT NULL,
  from_addr   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL,
  outcome     TEXT,
  model       TEXT,
  error       TEXT
);
INSERT INTO emails_v2 (id, user_id, message_id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error)
  SELECT id, COALESCE((SELECT id FROM users WHERE role = 'owner' LIMIT 1), ''), message_id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error
  FROM emails;
DROP TABLE emails;
ALTER TABLE emails_v2 RENAME TO emails;
CREATE UNIQUE INDEX emails_user_message ON emails (user_id, message_id);
CREATE INDEX emails_user_received ON emails (user_id, received_at);
CREATE INDEX emails_stored_at ON emails (stored_at);

-- 2. Gmail 转发验证信等提醒：按人分
ALTER TABLE notices ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
UPDATE notices SET user_id = COALESCE((SELECT id FROM users WHERE role = 'owner' LIMIT 1), '');

-- 3. 每个人的设置（看板操作 edits、偏好 prefs、简历 resume）。settings 表只留系统自己的（monitor）。
CREATE TABLE user_settings (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
INSERT INTO user_settings (user_id, key, value, updated_at)
  SELECT (SELECT id FROM users WHERE role = 'owner' LIMIT 1), key, value, updated_at
  FROM settings
  WHERE key IN ('edits', 'prefs', 'resume') AND EXISTS (SELECT 1 FROM users WHERE role = 'owner');
DELETE FROM settings WHERE key IN ('edits', 'prefs', 'resume') AND EXISTS (SELECT 1 FROM users WHERE role = 'owner');

-- 4. 账号：每人一个收信地址（u-口令@域名）、允许哪些邮箱转信进来、AI 开关
ALTER TABLE users ADD COLUMN inbox_token TEXT;
CREATE UNIQUE INDEX users_inbox_token ON users (inbox_token);
ALTER TABLE users ADD COLUMN forwarders TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 1;

-- 5. 每人每天用了几次 AI（摘信息、一句话添加、面试准备都算），用来封顶费用
CREATE TABLE ai_usage (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,
  calls   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
