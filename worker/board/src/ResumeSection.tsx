import { useEffect, useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { ActionButton, ConfirmButton } from "@/components/demo/EventCard";
import { Section } from "@/components/demo/SettingsView";
import { formatWallClock } from "@/lib/demo/parseDemo";
import { MAX_RESUME_CHARS } from "@/lib/demo/prep";
import { RESUME_ACCEPT, resumeFileText } from "./resumeText";

interface StoredResume {
  text: string;
  fileName: string | null;
  updatedAt: string;
}

async function call<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/resume", {
    method,
    credentials: "same-origin",
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`);
  return data;
}

/**
 * 「设置 → 简历」：AI 面试准备会对着它挑你最该讲的经历。
 * 文件在浏览器里转成文字，你核对、可以改，点「保存」才存到云端；原文件不上传。
 */
export function ResumeSection({ viewerTimeZone }: { viewerTimeZone: string }) {
  const [stored, setStored] = useState<StoredResume | null | undefined>(undefined);
  const [draft, setDraft] = useState<{ text: string; fileName: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    let alive = true;
    call<{ resume: StoredResume | null }>("GET").then(
      (r) => alive && setStored(r.resume),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : "读取失败"),
    );
    return () => {
      alive = false;
    };
  }, []);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy("正在提取文字…");
    try {
      setDraft({ text: await resumeFileText(file), fileName: file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "提取失败，请直接粘贴文字");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy("保存中…");
    setError(null);
    try {
      const r = await call<{ resume: StoredResume }>("PUT", draft);
      setStored(r.resume);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("删除中…");
    setError(null);
    try {
      await call("DELETE");
      setStored(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(null);
    }
  };

  const upload = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={RESUME_ACCEPT}
        className="sr-only"
        id={`${id}-file`}
        data-resume-file
        onChange={(e) => void pickFile(e.target.files?.[0])}
      />
      <label
        htmlFor={`${id}-file`}
        className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-hairline px-3 py-1 text-xs text-ink-soft hover:bg-raised hover:text-ink"
      >
        <FileUp size={12} aria-hidden />
        {stored ? "换一份" : "上传文件"}
      </label>
    </>
  );

  return (
    <Section
      title="简历"
      hint="「AI 面试准备」会对着你的简历挑出这场面试最该讲的经历。支持 PDF、Word（.docx）、TXT，也可以直接粘贴。文件在你的浏览器里转成文字，原文件不上传；云端只存你核对过的文字，只有你点「生成」时才发给 AI。"
    >
      <div data-resume>
        {stored === undefined && error === null ? <p className="text-sm text-ink-faint">读取中…</p> : null}

        {draft ? (
          <div className="space-y-2">
            <label className="block text-xs text-ink-soft" htmlFor={`${id}-text`}>
              {draft.fileName ? `从「${draft.fileName}」提取的文字：` : "粘贴你的简历："}核对一下，可以直接改。
            </label>
            <textarea
              id={`${id}-text`}
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              rows={14}
              maxLength={MAX_RESUME_CHARS}
              data-resume-draft
              className="w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2 text-sm leading-relaxed text-ink"
            />
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton onClick={() => void save()} tone="primary" action="resume-save">
                保存
              </ActionButton>
              <ActionButton onClick={() => setDraft(null)} action="resume-cancel">
                取消
              </ActionButton>
              <span className="text-xs text-ink-faint tabular">
                {draft.text.length} / {MAX_RESUME_CHARS} 字
              </span>
            </div>
          </div>
        ) : stored ? (
          <div className="space-y-2 rounded-xl border border-hairline bg-surface px-4 py-3">
            <p className="text-sm text-ink" data-resume-stored>
              {stored.fileName ?? "粘贴的文字"}
              <span className="ml-2 text-xs text-ink-faint">
                {stored.text.length} 字 · {stored.updatedAt ? `${formatWallClock(stored.updatedAt, viewerTimeZone)} 保存` : ""}
              </span>
            </p>
            <p className={`text-xs leading-relaxed whitespace-pre-wrap text-ink-soft ${expanded ? "" : "line-clamp-4"}`}>{stored.text}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setExpanded(!expanded)} className="text-xs text-on-brand-soft underline-offset-2 hover:underline">
                {expanded ? "收起" : "展开全部"}
              </button>
              <span className="flex-1" />
              {upload}
              <ActionButton onClick={() => setDraft({ text: stored.text, fileName: stored.fileName })} action="resume-edit">
                编辑
              </ActionButton>
              <ConfirmButton onConfirm={() => void remove()} confirmText="确认删除" action="resume-delete">
                删除
              </ConfirmButton>
            </div>
          </div>
        ) : stored === null ? (
          <div className="flex flex-wrap items-center gap-2">
            {upload}
            <ActionButton onClick={() => setDraft({ text: "", fileName: null })} action="resume-paste">
              粘贴文字
            </ActionButton>
            <span className="text-xs text-ink-faint">还没有简历：AI 面试准备里「你可以讲的经历」那一部分会空着</span>
          </div>
        ) : null}

        {busy ? (
          <p className="mt-2 text-xs text-ink-soft" role="status">
            {busy}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-xs text-on-drop-soft" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
