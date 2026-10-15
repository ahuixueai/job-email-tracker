import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** 测试单独配置：不继承 vite.config.ts 的 root（那是给看板构建用的）。 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../web", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts", "board/test/**/*.test.ts"],
  },
});
