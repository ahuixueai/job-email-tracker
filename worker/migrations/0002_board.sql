-- 私人看板要用的两张表。

-- 键值设置。目前只有一个键：edits = 你在看板上的全部手动操作（JSON，形状见 web/lib/demo/userEdits.ts）。
-- 收信程序处理新邮件时也读它：里面的 companyZones（你确认过的「这家公司按哪个时区」）是时区线索。
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 登录失败记录，用来限制猜密码：同一个来源一小时内失败 10 次就暂时锁住。
CREATE TABLE login_failures (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX login_failures_ip_at ON login_failures (ip, at);
