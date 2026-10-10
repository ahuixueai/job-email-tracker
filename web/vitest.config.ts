import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 单元测试只覆盖 lib/ 与 store/ 里的纯逻辑。
 * 组件与端到端行为归 e2e/ 那套跑批管，两者不重叠。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "store/reducers.ts"],
      /**
       * 排除的都是「只有在浏览器里才有意义」的模块：读写 localStorage、
       * 操作 DOM、振动与撒花、Web Audio、React hook。
       * 这些归 e2e/ 那套跑批验（配色对比度、reduced-motion、持久化都在那边），
       * 在 node 里给它们造一套假 DOM 只会测出假的安全感。
       */
      exclude: [
        // 解析引擎是从 tracker-core 同步来的生成物，在它自己的仓库里测（480 条）
        "lib/tracker-core/**",
        "lib/**/use*.ts",
        "lib/motion.ts",
        "lib/pinkNoise.ts",
        "lib/theme.ts",
        "lib/prefs.ts",
        "lib/feedback.ts",
        "lib/pepTalk.ts",
      ],
      // 低于门槛直接失败，且是逐文件算——总分达标掩盖不了某个文件裸奔
      thresholds: { lines: 80, perFile: true },
      reporter: ["text", "json-summary"],
    },
  },
});
