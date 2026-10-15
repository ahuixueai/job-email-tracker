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

先用免费版试：Cloudflare 免费版能给**在 Email Routing 里验证过的地址**发信（第 1 期只有作者一个账号，够用）。做成多人产品、要给任意邮箱发码时，再升 Workers 付费版。

1. Cloudflare 后台 → 你的域名 → Email → Email Routing → Destination addresses：添加 `OWNER_EMAIL` 那个邮箱，去邮箱里点验证链接
2. Cloudflare 后台「Turnstile」新建一个站点：域名填 `board.你的域名`，模式选 Managed。站点密钥（公开的）填进 `wrangler.toml` 的 `TURNSTILE_SITE_KEY`
3. 存两把私密钥匙（输入不显示）：

```bash
npx wrangler secret put TURNSTILE_SECRET
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
```

4. `npm run db:init`（建账号表）→ `npm run deploy`

没开通前也能部署：验证码登录会提示「暂时只能用密码登录」，密码照常能用。

## 安全与隐私

- **只收允许列表里的 Gmail 转来的信**（`wrangler.toml` 的 `ALLOWED_FORWARDERS`）。陌生人发到收信地址的信直接拒收，不存、不调模型。
- **模型密钥**只用 `wrangler secret put` 设置，不写进任何文件、不进 git。
- **存了什么**：清洗后的正文纯文本（不存附件、不存 HTML），在你自己的 Cloudflare 账号的 D1 里。看板「详情」里高亮原文要用它。
- 日志只记处理结论（存了 / 拒收 / 重复），不记邮件内容。
- **看板要登录**：页面本身不含任何邮件；数据全在 `/api/*` 后面，没登录一律 401。
  - 主要方式：**邮箱验证码**（6 位、10 分钟有效、最多试 5 次；同一邮箱 60 秒内不能重发、一小时最多 5 次；同一来源一小时最多发 20 次）。
    不在名单里的邮箱也回答「已发送」但不真发，外人试不出谁有账号。第 1 期只有 `OWNER_EMAIL` 这一个账号。
  - 发码和密码登录前都要过 **Cloudflare Turnstile**（防机器人）。
  - 备用：作者账号的看板密码（`wrangler secret put BOARD_PASSWORD`）。同一来源一小时内输错 10 次（密码或验证码）锁一小时。
  - 登录凭证是签了名的 cookie（HttpOnly、Secure、SameSite=Strict），里面带着是谁；签名钥匙是 `SESSION_SECRET`（没设时退回用看板密码）。
- **日历订阅口令**每人一把，存在数据库里，和登录无关；泄露了在设置里「换一个新链接」。作者账号沿用升级前的旧链接。
- **你自己写的信**（比如回复 HR 时抄送了收信地址）只存档（status = self），不解析、不调模型，不会被当成一件新安排。
- **你确认过的时区会被记住**：在看板上「放进日程」时勾选「以后这家公司都按…」，之后这家公司没写时区的信就按它换算。

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
