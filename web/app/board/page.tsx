import { cookies } from "next/headers";
import { InterviewBoard } from "@/components/InterviewBoard";
import { TimeZoneProvider } from "@/components/TimeZoneProvider";
import { TIME_ZONE_COOKIE, parseTimeZoneCookie } from "@/lib/prefs";
import { DEMO_MODE } from "@/lib/demoMode";

/**
 * 读 cookie 会让本路由从静态预渲染转为按请求渲染。
 * 这是拿掉「非首访双列抖动」必须付的代价：本机时区只有请求上下文里才知道。
 * 面试数据与筛选状态走 localStorage，由客户端 rehydrate 后接管。
 */
/**
 * 旧版看板（手势排序、滑动记 Offer、专注模式、备战胶囊）。
 * 2026-10-09 起首页换成了四视图的新看板（components/demo/Workspace.tsx），
 * 这一版原样保留在 /board，功能与数据来源都没有动。
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string }>;
}) {
  const cookieStore = await cookies();
  const initialTimeZone = parseTimeZoneCookie(
    cookieStore.get(TIME_ZONE_COOKIE)?.value,
  );
  // `?seed=demo` 只喂给 e2e 与手动演示——真实用户永远不会自己拼出这个参数，
  // 默认路径看到的必须是真实台账或空状态，不是别人的公司名。
  //
  // DEMO_MODE 是公网演示站的整站开关（只在 Vercel 上设 NEXT_PUBLIC_DEMO_MODE=1）。
  // **本机不设这个变量，所以本机行为和以前一字不差**——默认仍然是真实台账/空状态。
  const { seed } = await searchParams;
  const seedDemo = seed === "demo" || DEMO_MODE;
  return (
    <main className="min-h-full">
      <TimeZoneProvider initialTimeZone={initialTimeZone}>
        <InterviewBoard seedDemo={seedDemo} />
      </TimeZoneProvider>
    </main>
  );
}
