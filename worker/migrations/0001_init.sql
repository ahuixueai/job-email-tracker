-- 收到的邮件，一封一行。
-- body 存的是拆信清洗后的纯文本（不存附件、不存 HTML），看板「详情」里高亮原文要用它。
CREATE TABLE emails (
  id          TEXT PRIMARY KEY,
  message_id  TEXT UNIQUE,                 -- 邮件自带的 Message-ID：同一封信转发两次只存一次
  received_at TEXT NOT NULL,               -- 原信的发信时刻（UTC）。相对期限「72 小时内」从它起算
  stored_at   TEXT NOT NULL,               -- 进库时刻（UTC）
  via         TEXT NOT NULL,               -- auto = Gmail 自动转发；manual = 手动点「转发」
  from_addr   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL,               -- parsed | dropped | error
  outcome     TEXT,                        -- 解析引擎的完整结论（JSON），含每一步的依据
  model       TEXT,                        -- 用了哪个模型；NULL = 只用了规则
  error       TEXT                         -- 出错原因（不含邮件内容）
);
CREATE INDEX emails_received_at ON emails (received_at);

-- 不是求职邮件、但需要你看一眼的东西。目前只有一种：Gmail 开启转发时发来的验证邮件。
CREATE TABLE notices (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  received_at TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL
);
