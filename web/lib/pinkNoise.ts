"use client";

/**
 * 实时合成的粉红噪声：不引用任何外部音频文件或 CDN。
 *
 * 做法是 Paul Kellet 的滤波器组近似 1/f 谱，把 4 秒缓冲填满后 loop 播放，
 * 再串一级低通把高频毛刺磨掉。缓冲够长，听不出循环接缝。
 */

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  // AudioContext 挂在 globalThis 上，用 typeof window 保住那部分类型
  const w = window as typeof window & { webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 浏览器是否支持 Web Audio。不支持时开关整个隐藏，不做假按钮。 */
export function canSynthesizeNoise(): boolean {
  return getAudioContextCtor() !== null;
}

export interface NoiseHandle {
  setVolume: (value: number) => void;
  /** 停止播放并 close() 掉 AudioContext，释放音频线程。 */
  dispose: () => Promise<void>;
}

function fillPinkNoise(buffer: AudioBuffer): void {
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
  }
}

/**
 * 必须在用户手势的调用栈里执行——浏览器的 autoplay 策略只认这一条。
 * 返回 null 表示环境不支持，调用方据此隐藏开关。
 */
export async function startPinkNoise(
  volume: number,
): Promise<NoiseHandle | null> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;

  const ctx = new Ctor();
  // Safari 上新建的 context 可能是 suspended，手势栈里 resume 才会放行。
  if (ctx.state === "suspended") await ctx.resume();

  const buffer = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
  fillPinkNoise(buffer);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 1_200;

  const gain = ctx.createGain();
  gain.gain.value = volume;

  source.connect(lowpass).connect(gain).connect(ctx.destination);
  source.start();

  let disposed = false;

  return {
    setVolume: (value) => {
      if (disposed) return;
      // 用 ramp 而不是直接赋值，避免拖滑块时爆音。
      gain.gain.setTargetAtTime(value, ctx.currentTime, 0.02);
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      try {
        source.stop();
      } catch {
        // 已经停过就忽略
      }
      source.disconnect();
      lowpass.disconnect();
      gain.disconnect();
      await ctx.close();
    },
  };
}
