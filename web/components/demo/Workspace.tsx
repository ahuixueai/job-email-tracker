"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Board } from "@/components/demo/Board";
import { runDemoParse } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";
import { hasRecording, parseRecording, RecordedExtractor } from "@/lib/demo/recorded";
import recordedJson from "@/lib/demo/recordedExtractions.json";
import { buildSampleEmails } from "@/lib/demo/sampleEmails";
import { EDITS_STORAGE_KEY, EMPTY_EDITS, hasEdits, parseEdits } from "@/lib/demo/userEdits";
import type { UserEdits } from "@/lib/demo/userEdits";

const RECORDING = parseRecording(recordedJson);

const subscribeNever = () => () => {};

/**
 * 样本里的日期相对「现在」生成，服务端与浏览器的「现在」不是同一刻，
 * 直接渲染必然 hydration mismatch。所以整块只在客户端挂载后才出现。
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/** 读浏览器里存的手动操作。隐私模式、存储被禁用时读不到，按「没有任何操作」处理。 */
function loadEdits(): UserEdits {
  try {
    const raw = window.localStorage.getItem(EDITS_STORAGE_KEY);
    return raw === null ? EMPTY_EDITS : parseEdits(JSON.parse(raw));
  } catch {
    return EMPTY_EDITS;
  }
}

function saveEdits(edits: UserEdits): void {
  try {
    if (hasEdits(edits)) window.localStorage.setItem(EDITS_STORAGE_KEY, JSON.stringify(edits));
    else window.localStorage.removeItem(EDITS_STORAGE_KEY);
  } catch {
    // 存不了就只在这次打开期间有效，页面照常能用
  }
}

/**
 * 演示站的主看板：数据是 lib/demo/sampleEmails.ts 的合成邮件，现场用解析引擎算出来；
 * 你在页面上做的手动操作只存在这台浏览器里。展示与交互都在 Board 里。
 */
export function Workspace() {
  const mounted = useMounted();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      {mounted ? <Loaded /> : <p className="pt-10 text-sm text-ink-faint">载入中…</p>}
    </div>
  );
}

function Loaded() {
  const [nowMs] = useState(() => Date.now());
  const [viewerTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const samples = useMemo(() => buildSampleEmails(nowMs), [nowMs]);
  const [results, setResults] = useState<ReadonlyMap<string, DemoResult>>(new Map());
  const [edits, setEdits] = useState<UserEdits>(loadEdits);

  const update = useCallback((change: (current: UserEdits) => UserEdits) => {
    setEdits((current) => {
      const next = change(current);
      saveEdits(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all(
      samples.map(async (sample) => {
        const result = await runDemoParse(sample.raw, {
          viewerTimeZone,
          ...(hasRecording(RECORDING, sample.id)
            ? { extractor: new RecordedExtractor(RECORDING, sample.tokens) }
            : {}),
        });
        return [sample.id, result] as const;
      }),
    ).then(
      (pairs) => {
        if (alive) setResults(new Map(pairs));
      },
      () => {
        // 引擎只在内部不变量被破坏时才抛异常。看板不该因此白屏。
        if (alive) setResults(new Map());
      },
    );
    return () => {
      alive = false;
    };
  }, [samples, viewerTimeZone]);

  const extractorNoteFor = (sampleIds: readonly string[]) =>
    sampleIds.some((id) => hasRecording(RECORDING, id))
      ? `公司、岗位、时间片段由模型从原文摘出（${RECORDING.model}，预先录制）；是什么事、什么时候、哪个时区由规则判断。`
      : "这里只用了规则，没有模型参与。";

  return (
    <Board
      samples={samples}
      results={results}
      edits={edits}
      onEditsChange={update}
      nowMs={nowMs}
      viewerTimeZone={viewerTimeZone}
      notice="演示数据：以下公司与邮件均为虚构。你在页面上的手动操作只保存在这台浏览器里。"
      extractorNoteFor={extractorNoteFor}
    />
  );
}
