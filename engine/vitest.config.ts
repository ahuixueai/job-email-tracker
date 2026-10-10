import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // 五个模块的行覆盖率门槛，低于此值直接失败
      thresholds: { lines: 80, perFile: true },
      reporter: ["text", "json-summary"],
    },
  },
});
