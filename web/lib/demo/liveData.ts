import { notParsedResult, toDemoResult } from "./parseDemo";
import type { DemoResult } from "./parseDemo";
import type { SampleEmail } from "./sampleEmails";
import type { ParseOutcome } from "../tracker-core/index";

/**
 * 收信程序存下的邮件（D1 的 emails 表）→ 看板要的「样本 + 结论」。
 * 私人看板页面和收信程序里的日历订阅都用它，所以放在共享的 lib 里。
 */
/** /api/emails 返回的一行，字段与 D1 的 emails 表一致。 */
export interface EmailRow {
  id: string;
  received_at: string;
  stored_at: string;
  via: string;
  from_addr: string;
  subject: string;
  body: string;
  status: string;
  outcome: string | null;
  model: string | null;
  error: string | null;
}

export interface LiveData {
  samples: SampleEmail[];
  results: Map<string, DemoResult>;
  /** 邮件 id → 用了哪个模型（null = 只用了规则）。 */
  models: Map<string, string | null>;
}

const VIA_LABEL: Readonly<Record<string, string>> = {
  auto: "Gmail 自动转发",
  manual: "你手动转发",
  self: "你自己发出的信",
};

/**
 * 收信程序存下的邮件 → 看板要的「样本 + 结论」。
 *
 * 结论直接用收信时引擎算好的那份（存在 outcome 里），这里不重算：
 * 看板看到的必须就是收信时的判断，否则「为什么进了待确认」就对不上库里的记录。
 *
 * 按收信时刻**从旧到新**排：同一件事的几封信（原通知 + 催办）合并时，
 * 看板用最早那封的 id 当这件事的 id，你的确认、忽略都记在这个 id 上。
 * 新来的信永远排在后面，这个 id 就不会因为来了一封催办而变掉。
 */
export function toLiveData(rows: readonly EmailRow[], viewerTimeZone: string): LiveData {
  const ordered = [...rows].sort((a, b) => a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id));
  const samples: SampleEmail[] = [];
  const results = new Map<string, DemoResult>();
  const models = new Map<string, string | null>();
  for (const row of ordered) {
    samples.push({
      id: row.id,
      title: row.subject,
      teaches: VIA_LABEL[row.via] ?? row.via,
      raw: {
        id: row.id,
        from: row.from_addr,
        to: "",
        subject: row.subject,
        body: row.body,
        receivedAtUtc: row.received_at,
      },
      tokens: {},
    });
    results.set(row.id, resultOf(row, viewerTimeZone));
    models.set(row.id, row.model);
  }
  return { samples, results, models };
}

function resultOf(row: EmailRow, viewerTimeZone: string): DemoResult {
  if (row.status === "self") {
    return notParsedResult("你发出的信", "这是你自己写的信（例如回复 HR 时抄送了收信地址），只存档，不当成新的安排。");
  }
  if (row.outcome === null) {
    return notParsedResult("处理出错", row.error ?? "收信时解析失败，没有留下原因");
  }
  try {
    return toDemoResult(JSON.parse(row.outcome) as ParseOutcome, viewerTimeZone);
  } catch (error) {
    // 库里的结论是旧版本引擎写的、形状对不上：不让整个看板白屏，只这一封显示出错
    return notParsedResult("处理出错", `存下的解析结论读不出来：${error instanceof Error ? error.message : String(error)}`);
  }
}

