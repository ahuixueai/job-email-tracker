import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** 单元测试覆盖 lib/demo 里的纯逻辑（解析结论怎么摆、投递表、编辑、搜索……）。解析引擎在 ../engine 里自己测。 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
  },
});
