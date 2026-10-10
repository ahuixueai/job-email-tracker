import type { ThemeColors, ThemeName } from "@/types";

export const THEME_STORAGE_KEY = "jcc_theme";
export const PEPTALK_STORAGE_KEY = "jcc_peptalk";

export const THEME_LABEL: Record<ThemeName, string> = {
  light: "清醒蓝黄",
  dark: "暗黑极客",
};

/** ThemeColors 的字段名 → CSS 变量名。 */
const CSS_VAR: Record<keyof ThemeColors, string> = {
  canvas: "--jcc-canvas",
  surface: "--jcc-surface",
  raised: "--jcc-raised",
  hairline: "--jcc-hairline",
  ink: "--jcc-ink",
  inkSoft: "--jcc-ink-soft",
  inkFaint: "--jcc-ink-faint",
  brand: "--jcc-brand",
  brandLine: "--jcc-brand-line",
  brandSoft: "--jcc-brand-soft",
  onBrandSoft: "--jcc-on-brand-soft",
  accent: "--jcc-accent",
  accentSoft: "--jcc-accent-soft",
  onAccent: "--jcc-on-accent",
};

/**
 * 自定义主题的扩展点。
 *
 * 下一步的「上传图片提取主色调」只需产出一个 ThemeColors，就能套进来——
 * 取色、明度校正、对比度兜底都还没实现，本轮只落地签名与写入通道。
 *
 * TODO(下一轮): 接入取色器后，写入前必须跑一遍对比度校验，
 * 任何一对前景/背景低于 WCAG AA 就自动调整明度，而不是直接写进去。
 */
export function applyCustomTheme(colors: ThemeColors): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(CSS_VAR)) {
    const value = colors[key as keyof ThemeColors];
    if (value) root.style.setProperty(cssVar, value);
  }
}

/** 清掉 applyCustomTheme 写入的行内变量，回到内置主题。 */
export function clearCustomTheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const cssVar of Object.values(CSS_VAR)) {
    root.style.removeProperty(cssVar);
  }
}

/**
 * 在 hydration 之前跑的内联脚本。
 *
 * 必须同步执行且尽可能短：它决定首帧的 data-theme 与 data-peptalk，
 * 晚一帧就会出现浅色闪一下再切暗色。localStorage 读不到时回落到
 * prefers-color-scheme；两者都拿不到就是 light。
 */
export const THEME_BOOT_SCRIPT = `(function(){try{
var d=document.documentElement;
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}
d.setAttribute("data-theme",t);
var p=localStorage.getItem(${JSON.stringify(PEPTALK_STORAGE_KEY)});
d.setAttribute("data-peptalk",p==="off"?"off":"on");
}catch(e){document.documentElement.setAttribute("data-theme","light");document.documentElement.setAttribute("data-peptalk","on");}})();`;
