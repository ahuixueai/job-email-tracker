import { EMPTY_EXTRACTION, StubExtractor } from "../tracker-core/index";
import type { CleanEmail, Extraction, LLMExtractor } from "../tracker-core/index";

/**
 * 模型抽取结果的录制与回放。
 *
 * 演示站**不在线调用模型**：公网页面上放一个带密钥的接口，等于把账单交给任何
 * 路过的人。所以对内置的合成样本，先在本机用真实模型跑一遍、把结果存成 JSON
 * （`scripts/record-extractions.ts`），演示站只回放。
 *
 * 回放的仍然只是「模型摘出的片段」。片段之后的全部判定——时间语义、时区、
 * 置信度、去向——每次打开页面都由规则引擎现场重算，不是录下来的。
 */

export interface Recording {
  /** 录制时用的模型名。null 表示还没录过。 */
  model: string | null;
  /** 录制日期（YYYY-MM-DD）。 */
  recordedOn: string | null;
  /** 样本 id → 抽取结果。日期片段以 `{{占位名}}` 存储。 */
  extractions: Readonly<Record<string, Extraction>>;
}

export const EMPTY_RECORDING: Recording = { model: null, recordedOn: null, extractions: {} };

const STRING_FIELDS = ["companyRaw", "roleRaw", "locationRaw", "timeText"] as const;

/** 录制时用：把本次生成的日期文本换回占位名。长的先换，避免短串抢先命中。 */
export function tokenize(extraction: Extraction, tokens: Readonly<Record<string, string>>): Extraction {
  const entries = Object.entries(tokens).sort((a, b) => b[1].length - a[1].length);
  const out: Extraction = { ...extraction };
  for (const field of STRING_FIELDS) {
    let value = out[field];
    if (value === null) continue;
    for (const [name, text] of entries) {
      if (text.length > 0) value = value.split(text).join(`{{${name}}}`);
    }
    out[field] = value;
  }
  return out;
}

/** 回放时用：把占位名还原成今天生成的日期文本。 */
export function detokenize(extraction: Extraction, tokens: Readonly<Record<string, string>>): Extraction {
  const out: Extraction = { ...extraction };
  for (const field of STRING_FIELDS) {
    const value = out[field];
    if (value === null) continue;
    out[field] = value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, name: string) => tokens[name] ?? whole);
  }
  return out;
}

/** 运行时校验录制文件的形状。文件是脚本生成的，但手改或截断都可能发生。 */
export function parseRecording(value: unknown): Recording {
  if (typeof value !== "object" || value === null) return EMPTY_RECORDING;
  const raw = value as Record<string, unknown>;
  const source = raw.extractions;
  if (typeof source !== "object" || source === null) return EMPTY_RECORDING;

  const extractions: Record<string, Extraction> = {};
  for (const [id, entry] of Object.entries(source as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
    extractions[id] = {
      ...EMPTY_EXTRACTION,
      companyRaw: text(e.companyRaw),
      roleRaw: text(e.roleRaw),
      locationRaw: text(e.locationRaw),
      timeText: text(e.timeText),
      // 取值是否合法交给 pipeline 里的 validateExtraction，这里只保证类型
      eventTypeHint: (text(e.eventTypeHint) as Extraction["eventTypeHint"]) ?? null,
      notJobRelated: e.notJobRelated === true,
    };
  }
  return {
    model: typeof raw.model === "string" && raw.model.length > 0 ? raw.model : null,
    recordedOn: typeof raw.recordedOn === "string" ? raw.recordedOn : null,
    extractions,
  };
}

export function hasRecording(recording: Recording, sampleId: string): boolean {
  return recording.model !== null && Object.hasOwn(recording.extractions, sampleId);
}

/**
 * 按样本 id 回放录制的抽取结果。没录过的 id 退回桩抽取器——
 * 调用方应当先用 hasRecording 判断，再决定界面上要不要写「模型」二字。
 */
export class RecordedExtractor implements LLMExtractor {
  private readonly fallback = new StubExtractor();

  constructor(
    private readonly recording: Recording,
    private readonly tokens: Readonly<Record<string, string>>,
  ) {}

  extract(email: CleanEmail): Promise<Extraction> {
    if (!hasRecording(this.recording, email.id)) return this.fallback.extract(email);
    const recorded = this.recording.extractions[email.id];
    return Promise.resolve(detokenize(recorded, this.tokens));
  }
}
