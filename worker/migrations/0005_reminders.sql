-- 邮件提醒（10/19）：记下哪些提醒已经发过，同一个提醒不发第二次。
-- key = 事件 id | 提醒种类（前一晚 / 截止前 24 小时 / 3 小时）| 事件时间：时间改了会按新时间再提醒。
-- 发出 30 天后的记录自动删掉（到那时事件早就过去了）。
CREATE TABLE reminders_sent (
  user_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
