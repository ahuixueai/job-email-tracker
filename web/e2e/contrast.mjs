/**
 * 配色对比度验收：两套主题的每一对前景/背景都要达到 WCAG AA。
 * 直接读 globals.css，改了颜色就会被这里抓到。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css"),
  "utf8",
);

function block(selector) {
  const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "m");
  const body = css.match(re)?.[1] ?? "";
  const vars = {};
  for (const line of body.split("\n")) {
    const m = line.match(/(--jcc-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

const light = block(":root");
const dark = { ...light, ...block('\\[data-theme="dark"\\]') };

const srgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
};
const lum = (hex) => {
  const [r, g, b] = srgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/**
 * [说明, 前景 token, 背景 token, 最低要求, 类别]
 * 类别决定 AA 的门槛：正文 4.5:1、大字 3:1（SC 1.4.3）、
 * 非文字的 UI 组件与焦点指示 3:1（SC 1.4.11）。
 */
const PAIRS = [
  ["卡片主标题 ink / surface", "--jcc-ink", "--jcc-surface", 4.5],
  ["页面主文字 ink / canvas", "--jcc-ink", "--jcc-canvas", 4.5],
  ["次要说明 ink-soft / surface", "--jcc-ink-soft", "--jcc-surface", 4.5],
  ["次要说明 ink-soft / canvas", "--jcc-ink-soft", "--jcc-canvas", 4.5],
  ["最弱说明 ink-faint / surface", "--jcc-ink-faint", "--jcc-surface", 4.5],
  ["最弱说明 ink-faint / canvas", "--jcc-ink-faint", "--jcc-canvas", 4.5],
  ["状态徽章 ink-soft / raised", "--jcc-ink-soft", "--jcc-raised", 4.5],
  ["时区缩写 ink-soft / raised", "--jcc-ink-soft", "--jcc-raised", 4.5],
  ["时间数值 ink / brand-soft", "--jcc-ink", "--jcc-brand-soft", 4.5],
  ["时区块标签 on-brand-soft / brand-soft", "--jcc-on-brand-soft", "--jcc-brand-soft", 4.5],
  ["描边按钮文字 ink / brand-soft", "--jcc-ink", "--jcc-brand-soft", 4.5],
  ["最高优先级星 on-accent / accent", "--jcc-on-accent", "--jcc-accent", 4.5],
  ["Offer 提示 on-offer-soft / offer-soft", "--jcc-on-offer-soft", "--jcc-offer-soft", 4.5],
  ["已挂提示 on-drop-soft / drop-soft", "--jcc-on-drop-soft", "--jcc-drop-soft", 4.5],
  ["专注模式倒计时 ink / canvas", "--jcc-ink", "--jcc-canvas", 3, "大字"],
  ["描边按钮边框 brand-line / surface", "--jcc-brand-line", "--jcc-surface", 3, "UI 组件"],
  ["焦点环 brand-line / canvas", "--jcc-brand-line", "--jcc-canvas", 3, "UI 组件"],
];

export async function run(check) {
for (const [name, theme] of [["浅色", light], ["深色", dark]]) {
  for (const [label, fg, bg, min, kind = "正文"] of PAIRS) {
    const f = theme[fg];
    const b = theme[bg];
    if (!f || !b) {
      check(`${name}｜${label}`, false, `变量缺失 ${fg} / ${bg}`);
      continue;
    }
    const r = ratio(f, b);
    check(
      `${name}｜${label}`,
      r >= min,
      `${r.toFixed(2)}:1（${kind}需 ${min}:1）${f} on ${b}`,
    );
  }
}
}
