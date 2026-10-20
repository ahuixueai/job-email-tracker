import type { Metadata, Viewport } from "next";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "准点 · InterviewTrack（演示）",
  description: "面试与笔试日程管理：双时区、优先级排序、滑动操作。",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f8fd" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1016" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /*
     * data-theme 由下面的内联脚本在首帧写入，服务端这里不猜——
     * 猜错就是浅色闪一下再切暗色。suppressHydrationWarning 只作用于
     * <html> 自身的属性，不会掩盖子树里的真实 mismatch。
     */
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <head>
        <script
          // 必须同步、阻塞式执行，放在任何样式生效之前
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
