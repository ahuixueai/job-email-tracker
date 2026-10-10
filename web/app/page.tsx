import { Workspace } from "@/components/demo/Workspace";

/**
 * 首页：主看板（日程 / 日历 / 待确认 / 投递 / 统计 / 邮件）。
 * 静态页面，全部解析在浏览器里跑。旧版看板在 /board。
 */
export default function Home() {
  return (
    <main className="min-h-full">
      <Workspace />
    </main>
  );
}
