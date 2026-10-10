/**
 * demo 模式：部署到公网的演示站用的开关。
 *
 * **为什么需要它**：这个产品阶段 A 全程在本机跑，`/api/*` 直读 `~/jobhunt/ledger.db`。
 * 部署到 Vercel 之后那个文件不存在，界面会显示「读不到台账」——
 * 而演示站要给的是「产品长什么样」，不是一条运维错误。
 *
 * **为什么不是把真数据传上去**：演示站没有登录。真实投递记录 + 公网 + 无鉴权 = 事故。
 * 见 `docs/产品完整性清单.md` §1（注册登录是阶段 B 的硬门槛，现在一项都没有）。
 *
 * 只在 Vercel 上设 `NEXT_PUBLIC_DEMO_MODE=1`。**本机不设，本机行为一字不变。**
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
