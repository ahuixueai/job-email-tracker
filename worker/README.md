# jobhunt-inbox · 收信程序 + 私人看板

把转发到 `jobs@你的域名` 的招聘邮件收下来：认人 → 拆信 → 解析引擎（规则 + 模型）→ 存进 Cloudflare D1。
同一个程序也托管你的**私人看板**（`board.你的域名`，要密码才能看）。
解析引擎直接引用同一仓库里的 `../engine/src`，看板直接引用 `../web` 的看板组件，一行不复制。

```
Gmail（过滤器自动转发 / 手动转发）
  → Cloudflare Email Routing（jobs@你的域名）
  → 本程序 email()：只收允许列表里的 Gmail 转来的信
  → parseEmail()：预筛 → DeepSeek 摘抄 → 规则判断
  → D1：emails 表（每封信 + 完整结论）、notices 表（Gmail 转发验证信）

浏览器 → board.你的域名
  → 本程序 fetch()：/api/* 要登录（一个密码换一张 30 天的签名 cookie）
  → 看板页面（board/，Vite 构建）：日程 / 日历 / 待确认 / 投递 / 统计 / 邮件
  → 你的确认、忽略、手动添加存回 D1 的 settings 表，换设备也在
```

## 第一次部署（在你自己的电脑上）

前提：域名已在 Cloudflare 上显示 **Active**。先把 `wrangler.toml` 里的网址、邮箱换成你自己的；收信地址显示在 `board/src/EmailGuide.tsx` 的 `INBOX_ADDRESS`，也换成你的。
脚本 `npm run import` / `npm run reparse` 用环境变量 `BOARD_URL` 指向你的看板。

```bash
cd worker
npm install
npx wrangler login                     # 浏览器里点授权
npx wrangler d1 create jobhunt-inbox   # 问要不要写进配置时选 yes
npm run db:init                        # 建表（以后加了新表也是这一句，只补没建过的）
npm run deploy                         # 构建看板并部署
npx wrangler secret put LLM_API_KEY    # 粘贴 DeepSeek key，输入不显示，回车
npx wrangler secret put BOARD_PASSWORD # 设看板密码，输入不显示，回车
```

然后在 Cloudflare 网页上把收信地址接到本程序：
**你的域名 → Email → Email Routing → 开启**（它会自动加好 MX 等记录）
→ **Routing rules → Create address**：地址填 `jobs`，Action 选 **Send to a Worker**，选 `jobhunt-inbox`，保存。

## 数据来源

看板只认**收到的邮件**、你在看板上手动加的和你的修改。

## 导入旧邮件

Gmail 过滤器只转发以后新来的信。已经在邮箱里的求职邮件用导入脚本补进来（和收信走同一条解析路，收信时刻用原信的时间）：

输入是一个 JSON 数组，每项有 `from` / `subject` / `snippet` / `date_utc`（用你习惯的 Gmail 导出方式生成即可）。

```bash
npm run import -- /tmp/jobs-import.json --dry-run
npm run import -- /tmp/jobs-import.json
```

脚本会让你在终端输入看板密码（不显示、不保存）。同一份文件跑两遍不会重复入库；没有带时区 Date 头的信不导入（不猜时间）。

## 验证

从你的 Gmail 手动转发一封招聘邮件到 `jobs@你的域名`，等半分钟：

```bash
npm run db:recent      # 最近 10 封：状态、发件人、主题、出错原因
npm run db:notices     # Gmail 转发验证信（开自动转发时用）
```

## 开通登录（验证码 + 防机器人）

Cloudflare 免费版只能给**在 Email Routing 里验证过的地址**发信（只有作者一个账号时够用）。多人内测要给任意邮箱发码，需要 Workers 付费版（见上面「升级到第 2 期的步骤」）。

1. Cloudflare 后台 → 你的域名 → Email → Email Routing → Destination addresses：添加 `OWNER_EMAIL` 那个邮箱，去邮箱里点验证链接
2. Cloudflare 后台「Turnstile」新建一个站点：域名填 `board.你的域名`，模式选 Managed。站点密钥（公开的）填进 `wrangler.toml` 的 `TURNSTILE_SITE_KEY`
3. 存两把私密钥匙（输入不显示）：

```bash
npx wrangler secret put TURNSTILE_SECRET
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
```

4. `npm run db:init`（建账号表）→ `npm run deploy`

没开通前也能部署：验证码登录会提示「暂时只能用密码登录」，密码照常能用。

## 多人内测（第 2 期）

每个人的邮件、提醒、看板操作、偏好、简历、AI 用量都按 `user_id` 分开存，接口只读写登录者自己的行。

- **收信地址认人**：作者还是 `jobs@域名`（Gmail 过滤器不用改）；其他人注册时分到 `u-10位随机口令@域名`。别的地址一律拒收。
- **转信邮箱认人**：每人只收自己登录邮箱、和自己在「设置 → 收信」里加的（最多 3 个）邮箱转来的信。作者另外沿用 `ALLOWED_FORWARDERS`。
- **开放注册**：新邮箱要验证码 → 填对 → 自动建账号（普通成员）。账号数到 `MAX_USERS`（默认 50）后，新邮箱直接提示「内测名额已满」。要停止新注册：`wrangler.toml` 里 `REGISTRATION = "closed"` 再部署。
- **AI 开关与额度**：每人可在「设置 → AI 与简历」关掉 AI（只用规则）。每人每天最多 `AI_DAILY_LIMIT`（默认 100）次 AI 调用，收信、一句话添加、面试准备各算一次；用完当天只用规则，记录里写明原因（不算模型失败，监控不报警）。作者不限。
- **监控**只给作者发信、设置页只有作者看得到；「3 天没收到信」只看作者自己的收信。
- **升级（数据迁移）**：`migrations/0004_multiuser.sql` 把已有的邮件、提醒、设置全部归到作者账号；作者账号还没建的话，作者第一次登录时认领。

### 邮件提醒（10/19）

- 每 15 分钟一次定时任务（`wrangler.toml` 的第二条 cron）：面试、笔试前一天晚上 8 点（按这个人的时区）一封；测评、网申截止前 24 小时、3 小时各一封，标了完成就不发。同一次该发的合成一封，发到登录邮箱。
- 时区按「你在哪」→ 最近一次打开看板时设备的时区 → 求职地 → 北京时间。
- 发过的记在 `reminders_sent` 表（`migrations/0005_reminders.sql`），30 天后自动删；删账号时一起删。
- 准点自己发的信（验证码、监控、提醒）被用户邮箱转回来，直接丢掉不存。
- 上线：`npm run db:init`（只跑 0005）→ `npm run deploy`。注意发信额度：验证码和提醒共用。

### 升级到第 2 期的步骤（在你的 Mac 上，按顺序）

1. **先备份**（见下面「备份与恢复」的第一条 export）
2. Cloudflare 订阅 **Workers Paid**（每月 5 美元）：验证码要发给任意邮箱，免费版只能发给验证过的地址
3. `npm run db:init`（只会跑 0004 这一个新迁移）→ `npm run deploy`
4. Cloudflare 后台 → `interviewtrack.me` → Email → Email Routing → Routing rules → **Catch-all address** → Action 选 **Send to a Worker** → `jobhunt-inbox` → 启用。
   已有的 `jobs`、`privacy` 两条规则保留不动（具体地址的规则优先于 catch-all）
5. 用另一个邮箱注册一次，按「邮件」页的教程设好转发，发一封测试信，确认只出现在新账号里

## 安全与隐私

- **只收这个人自己的邮箱转来的信**（作者另加 `wrangler.toml` 的 `ALLOWED_FORWARDERS`）。陌生人发到收信地址的信直接拒收，不存、不调模型。
- **模型密钥**只用 `wrangler secret put` 设置，不写进任何文件、不进 git。
- **存了什么**：清洗后的正文纯文本（不存附件、不存 HTML），在你自己的 Cloudflare 账号的 D1 里。看板「详情」里高亮原文要用它。
- 日志只记处理结论（存了 / 拒收 / 重复），不记邮件内容。
- **看板要登录**：页面本身不含任何邮件；数据全在 `/api/*` 后面，没登录一律 401。
  - 主要方式：**邮箱验证码**（6 位、10 分钟有效、最多试 5 次；同一邮箱 60 秒内不能重发、一小时最多 5 次；同一来源一小时最多发 20 次）。
    开放注册时，新邮箱也真发码，填对就建账号；关掉注册（`REGISTRATION = "closed"`）时，新邮箱也回答「已发送」但不真发，外人试不出谁有账号。
  - 发码和密码登录前都要过 **Cloudflare Turnstile**（防机器人）。
  - 备用：作者账号的看板密码（`wrangler secret put BOARD_PASSWORD`）。同一来源一小时内输错 10 次（密码或验证码）锁一小时。
  - 登录凭证是签了名的 cookie（HttpOnly、Secure、SameSite=Strict），里面带着是谁；签名钥匙是 `SESSION_SECRET`（没设时退回用看板密码）。
- **日历订阅口令**每人一把，存在数据库里，和登录无关；泄露了在设置里「换一个新链接」。作者账号沿用升级前的旧链接。
- **你自己写的信**（比如回复 HR 时抄送了收信地址）只存档（status = self），不解析、不调模型，不会被当成一件新安排。
- **你确认过的时区会被记住**：在看板上「放进日程」时勾选「以后这家公司都按…」，之后这家公司没写时区的信就按它换算。
- **时区设置**：第一次登录后先选「你现在在哪」（看板按它显示）和「你在哪找工作」（只能选一个）。信里、地点、发件域名、这家公司的记录都没有时区线索时，按求职地换算，详情里写明依据；改了求职地，看板会自动重算已收到的邮件。

## 对用户负责（试点前的底线）

- **隐私政策与使用条款**：`board/public/privacy.html`（公开页 `/privacy`），登录页和设置页都有链接。写清楚了存什么、交给谁（Cloudflare、DeepSeek——数据在中国境内处理）、保留多久、怎么删。里面的联系地址 `privacy@interviewtrack.me` 要在 Cloudflare Email Routing 里建一条转发规则才收得到。
- **删除我的账号和数据**：设置 → 数据与账号，手打「删除全部数据」确认，立即删掉这个人的所有行（邮件、提醒、设置、简历、AI 用量、验证码记录、账号本身）并退出登录，别人的不动（`src/privacy.ts`）。
- **定期清理**：定时任务顺带删掉 2 天前的登录 IP 记录、1 天没动的验证码记录。
- **安全响应头**：页面的在 `board-dist/_headers`（构建时生成，内联脚本哈希现算），接口和日历的在 `src/security.ts`。只许加载本站脚本和 Cloudflare 人机验证，禁止被别的网站嵌入。
- **依赖漏洞**：`npm audit`。上线代码里剩下的只有 mammoth → argparse（命令行解析用的，浏览器里读简历用不到）；其余都在测试工具里，不部署。

### 备份与恢复（上线后先演练一次）

Cloudflare 的数据库自带历史版本（Time Travel，免费版最近 7 天、付费版 30 天），出事可以按时间点恢复：`npx wrangler d1 time-travel info jobhunt-inbox`。但它会**原地覆盖**，所以平时另外导出一份，并验证这份导出真的能恢复：

```bash
mkdir -p ~/jobhunt/backups
npx wrangler d1 export jobhunt-inbox --remote --output ~/jobhunt/backups/jobhunt-backup.sql
npx wrangler d1 execute jobhunt-inbox --local --persist-to ~/jobhunt/backups/restore-test --file ~/jobhunt/backups/jobhunt-backup.sql
npx wrangler d1 execute jobhunt-inbox --local --persist-to ~/jobhunt/backups/restore-test --command "SELECT COUNT(*) AS n FROM emails"
npx wrangler d1 execute jobhunt-inbox --remote --command "SELECT COUNT(*) AS n FROM emails"
```

最后两条的数字一样，就说明备份能恢复（恢复到本机的一个临时库，不碰线上）。备份文件里是真实邮件：只放在 `~/jobhunt/backups/`，不进任何 git 仓库，用完的旧备份删掉。

## 已知限制

- **手动转发**的信，收信时刻取的是你点转发的时刻，不是原信的时刻（Gmail 的转发头里日期没有时区）。
  「72 小时内完成」这类相对期限会从转发时刻起算。日常请用 Gmail 过滤器**自动转发**，没有这个问题。
- Workers 免费套餐每次调用的 CPU 时间上限是 10 毫秒（网络等待不算）。按 147 封真实邮件实测，
  解析引擎单封中位数约 0.1 毫秒、最慢不到 1 毫秒；但完整邮件比评测样本长，MIME 拆信也要时间。
  如果日志里出现超时，需要升级到 Workers 付费套餐（每月 5 美元）。

## 开发

```bash
npm run check          # 类型检查 + 测试 + 构建看板
npm run dev:board      # 本地看板（配合另一个终端里的 npx wrangler dev）
```
