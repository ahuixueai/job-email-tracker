"use client";

import { motion } from "framer-motion";
import { Sun, Moon, MessageSquare, MessageSquareOff, FolderCog, ArrowDownUp, Plus, CalendarSync, HardDriveDownload, Filter } from "lucide-react";
import { SPRING } from "@/lib/motion";
import { useTheme } from "@/components/ThemeProvider";
import { DEMO_MODE } from "@/lib/demoMode";

interface HeaderControlsProps {
  reducedMotion: boolean;
  manualOrder: boolean;
  managerOpen: boolean;
  formOpen: boolean;
  googleOpen: boolean;
  backupOpen: boolean;
  funnelOpen: boolean;
  onResort: () => void;
  onToggleManager: () => void;
  onNewInterview: () => void;
  onToggleGoogle: () => void;
  onToggleBackup: () => void;
  onToggleFunnel: () => void;
}

/**
 * 主题与文案开关的当前状态用 CSS 表达，不用 React state 决定渲染什么。
 *
 * 理由：这两个开关的真值在 <html> 属性上，由内联脚本在 hydration 之前写好。
 * 如果按 state 渲染不同的图标/文案，服务端必然猜错一半，就会 hydration mismatch。
 * 两个都渲染、按属性显示其一，服务端和客户端的 HTML 完全一致。
 */
export function HeaderControls(props: HeaderControlsProps) {
  const { toggleTheme, togglePepTalk } = useTheme();
  const tap = props.reducedMotion ? undefined : { scale: 0.96 };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Pill
        tap={tap}
        onClick={props.onNewInterview}
        title="手动添加一场面试或笔试"
        active={props.formOpen}
      >
        <Plus size={13} aria-hidden />
        新建面试
      </Pill>

      <Pill
        tap={tap}
        onClick={props.onResort}
        disabled={!props.manualOrder}
        title="按优先级重新排序"
      >
        <ArrowDownUp size={13} aria-hidden />
        {props.manualOrder ? "恢复优先级排序" : "已按优先级排序"}
      </Pill>

      <Pill
        tap={tap}
        onClick={props.onToggleFunnel}
        title="从 ledger.db 直读求职漏斗"
        active={props.funnelOpen}
      >
        <Filter size={13} aria-hidden />
        漏斗
      </Pill>

      {/*
        「数据备份」与「Google 日历」在演示站上不渲染——不是禁用，是不存在。

        这两个入口通向的都是**本机运维**：备份面板导出的是这台设备 localStorage 里的
        东西；Google 面板没配 OAuth 时会把 `GOOGLE_CLIENT_ID` 缺哪几个环境变量、
        以及「照着 .env.local.example 填进 .env.local，重启 dev server」直接摊给用户看。
        手机上打开演示站的人没有 .env.local，也没有 dev server——**那不是文案不清楚，
        是把内部管线漏给了用户，再好的图解也救不了，它就不该出现。**

        不设 NEXT_PUBLIC_DEMO_MODE 时（本机开发、e2e 跑批）两个按钮照常在，
        面板逻辑一行没删，只是在用户路径上不可达。
      */}
      {DEMO_MODE ? null : (
        <>
          <Pill
            tap={tap}
            onClick={props.onToggleBackup}
            title="导出或导入 JSON 备份"
            active={props.backupOpen}
          >
            <HardDriveDownload size={13} aria-hidden />
            数据备份
          </Pill>

          <Pill
            tap={tap}
            onClick={props.onToggleGoogle}
            title="从 Google 日历导入面试"
            active={props.googleOpen}
          >
            <CalendarSync size={13} aria-hidden />
            Google 日历
          </Pill>
        </>
      )}

      <Pill
        tap={tap}
        onClick={props.onToggleManager}
        title="把面试分成几条线，之后可以只看其中一条"
        active={props.managerOpen}
      >
        <FolderCog size={13} aria-hidden />
        分组
      </Pill>

      <Pill
        tap={tap}
        onClick={togglePepTalk}
        title="显示或隐藏每日文案"
        ariaLabel="切换每日文案显示"
      >
        <span className="peptalk-on flex items-center gap-1.5">
          <MessageSquareOff size={13} aria-hidden />
          隐藏文案
        </span>
        <span className="peptalk-off flex items-center gap-1.5">
          <MessageSquare size={13} aria-hidden />
          显示文案
        </span>
      </Pill>

      <Pill
        tap={tap}
        onClick={toggleTheme}
        title="切换清醒蓝黄 / 暗黑极客"
        ariaLabel="切换主题"
      >
        <span className="theme-light-only flex items-center gap-1.5">
          <Moon size={13} aria-hidden />
          暗黑极客
        </span>
        <span className="theme-dark-only flex items-center gap-1.5">
          <Sun size={13} aria-hidden />
          清醒蓝黄
        </span>
      </Pill>
    </div>
  );
}

interface PillProps {
  onClick: () => void;
  title: string;
  ariaLabel?: string;
  disabled?: boolean;
  active?: boolean;
  tap: { scale: number } | undefined;
  children: React.ReactNode;
}

function Pill({ onClick, title, ariaLabel, disabled, active, tap, children }: PillProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      whileTap={disabled ? undefined : tap}
      transition={SPRING}
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium disabled:opacity-40 ${
        active
          ? "border-brand-line bg-brand-soft text-ink"
          : "border-hairline bg-surface text-ink-soft"
      }`}
    >
      {children}
    </motion.button>
  );
}
