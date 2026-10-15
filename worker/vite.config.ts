import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * 私人看板的构建。看板组件就是演示站那一套（web/components/demo），这里只换数据来源。
 * 用 @ 指向网页项目，和网页项目自己的写法一致；react 等强制用本目录装的那一份，避免同页两份 React。
 */
/**
 * 简历 PDF 在浏览器里转文字用 pdf.js。中文 PDF 常用没嵌入的 CJK 字体，pdf.js 要靠 cmaps 才认得出字；
 * 标准字体同理。构建时把这两个目录原样拷到 board-dist/pdfjs/ 下（只在上传简历时才会被取用）。
 */
function pdfjsData() {
  return {
    name: "copy-pdfjs-data",
    closeBundle() {
      for (const dir of ["cmaps", "standard_fonts"]) {
        cpSync(here(`./node_modules/pdfjs-dist/${dir}`), here(`./board-dist/pdfjs/${dir}`), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: here("./board"),
  plugins: [react(), tailwindcss(), pdfjsData()],
  resolve: {
    alias: { "@": here("../web") },
    dedupe: ["react", "react-dom", "lucide-react"],
  },
  build: {
    outDir: here("./board-dist"),
    emptyOutDir: true,
    // 不出 sourcemap：线上不需要，也不想把源码结构摊开
    sourcemap: false,
  },
  server: {
    // 本地开发：npm run dev:board 起看板，/api 转给 wrangler dev（默认 8787）
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
