"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Volume2, VolumeX } from "lucide-react";
import type { Interview } from "@/types";
import { SPRING } from "@/lib/motion";
import { canSynthesizeNoise, startPinkNoise, type NoiseHandle } from "@/lib/pinkNoise";
import { formatCountdown } from "@/lib/time";

interface FocusModeProps {
  interview: Interview;
  reducedMotion: boolean;
  onExit: () => void;
}

/** mm:ss，超过一小时显示 h:mm:ss。 */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function FocusMode({ interview, reducedMotion, onExit }: FocusModeProps) {
  // 这个组件只在点击后挂载，不参与 SSR，可以直接用真实时间。
  const [now, setNow] = useState(() => Date.now());
  const [volume, setVolume] = useState(0.35);
  const [noiseOn, setNoiseOn] = useState(false);
  const noiseRef = useRef<NoiseHandle | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // 退出时一定要把 AudioContext close 掉，否则音频线程会留着。
  useEffect(() => {
    return () => {
      void noiseRef.current?.dispose();
      noiseRef.current = null;
    };
  }, []);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const toggleNoise = useCallback(async () => {
    if (noiseRef.current) {
      await noiseRef.current.dispose();
      noiseRef.current = null;
      setNoiseOn(false);
      return;
    }
    // 必须留在这次点击的调用栈里，autoplay 策略才放行。
    const handle = await startPinkNoise(volume);
    noiseRef.current = handle;
    setNoiseOn(handle !== null);
  }, [volume]);

  const start = Date.parse(interview.startUtc);
  const end = Date.parse(interview.endUtc);
  const started = now >= start;
  const finished = now >= end;
  const remaining = started ? end - now : start - now;

  return (
    <motion.div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal
      aria-label={`${interview.company} 专注模式`}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.24 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 outline-none"
      style={{ backgroundColor: "var(--jcc-overlay)" }}
    >
      <div
        aria-hidden
        className="breathing pointer-events-none absolute h-[min(70vw,26rem)] w-[min(70vw,26rem)] rounded-full"
        style={{
          background:
            "radial-gradient(circle, var(--jcc-brand) 0%, transparent 68%)",
        }}
      />

      <div className="relative flex flex-col items-center text-center">
        <p className="text-xs tracking-widest text-ink-faint">专注模式</p>
        <h2 className="mt-2 text-lg font-semibold text-ink">
          {interview.company}
        </h2>
        <p className="text-sm text-ink-soft">{interview.position}</p>

        <p className="tabular mt-8 text-6xl font-semibold leading-none text-ink sm:text-7xl">
          {finished ? "结束" : clock(remaining)}
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          {finished
            ? "时间到了。"
            : started
              ? "剩余作答时间"
              : `距开始 · ${formatCountdown(interview.startUtc, now)}`}
        </p>

        <NoiseControls
          available={canSynthesizeNoise()}
          on={noiseOn}
          volume={volume}
          reducedMotion={reducedMotion}
          onToggle={() => void toggleNoise()}
          onVolume={(value) => {
            setVolume(value);
            noiseRef.current?.setVolume(value);
          }}
        />

        <motion.button
          type="button"
          onClick={onExit}
          whileTap={reducedMotion ? undefined : { scale: 0.96 }}
          transition={SPRING}
          className="mt-8 flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-medium text-ink"
        >
          <X size={15} aria-hidden />
          退出专注（Esc）
        </motion.button>
      </div>
    </motion.div>
  );
}

interface NoiseControlsProps {
  available: boolean;
  on: boolean;
  volume: number;
  reducedMotion: boolean;
  onToggle: () => void;
  onVolume: (value: number) => void;
}

function NoiseControls(props: NoiseControlsProps) {
  if (!props.available) return null;
  return (
    <div className="mt-10 flex items-center gap-3 rounded-full border border-hairline bg-surface px-3 py-2">
      <motion.button
        type="button"
        onClick={props.onToggle}
        whileTap={props.reducedMotion ? undefined : { scale: 0.94 }}
        transition={SPRING}
        aria-pressed={props.on}
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-ink"
      >
        {props.on ? <Volume2 size={15} aria-hidden /> : <VolumeX size={15} aria-hidden />}
        白噪音
      </motion.button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={props.volume}
        aria-label="白噪音音量"
        onChange={(event) => props.onVolume(Number(event.target.value))}
        className="h-1 w-32 accent-[var(--jcc-brand-line)]"
      />
    </div>
  );
}
