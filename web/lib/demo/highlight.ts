/**
 * 在邮件原文里标出系统用到的片段。
 *
 * 难点在于片段与原文**不是逐字相同**：引擎比对前会做 NFKC 归一化并忽略空白，
 * 所以模型摘的「考试时间:10月14日」对应原文的「考试时间：10月14日」（全角冒号）。
 * 这里用同样的宽松口径去找，再映射回原文的下标，高亮的才是原文里真实的那一段。
 */

export type MarkKind = "time" | "company" | "role" | "location";

export interface Mark {
  kind: MarkKind;
  fragment: string | null;
}

export interface Segment {
  text: string;
  /** null 表示普通文本。 */
  kind: MarkKind | null;
}

/** 重叠时谁优先。时间最重要：它决定用户会不会错过。 */
const PRIORITY: readonly MarkKind[] = ["time", "company", "role", "location"];

interface Folded {
  text: string;
  /** folded 中第 i 个字符对应原文的下标。 */
  origin: number[];
}

function fold(source: string): Folded {
  let text = "";
  const origin: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const folded = source[i].normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    for (const ch of folded) {
      text += ch;
      origin.push(i);
    }
  }
  return { text, origin };
}

/** 片段在原文中的 [start, end)。找不到返回 null。 */
export function locate(source: string, fragment: string): readonly [number, number] | null {
  const hay = fold(source);
  const needle = fold(fragment).text;
  if (needle.length === 0) return null;
  const at = hay.text.indexOf(needle);
  if (at < 0) return null;
  const start = hay.origin[at];
  const end = hay.origin[at + needle.length - 1] + 1;
  return [start, end];
}

export function highlightSegments(source: string, marks: readonly Mark[]): Segment[] {
  const ranges: { start: number; end: number; kind: MarkKind }[] = [];
  const ordered = [...marks].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  for (const mark of ordered) {
    if (mark.fragment === null) continue;
    const hit = locate(source, mark.fragment);
    if (hit === null) continue;
    const [start, end] = hit;
    // 与已占用的区间重叠就放弃这一个——优先级高的已经先占了位置
    if (ranges.some((r) => start < r.end && end > r.start)) continue;
    ranges.push({ start, end, kind: mark.kind });
  }
  ranges.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: source.slice(cursor, range.start), kind: null });
    segments.push({ text: source.slice(range.start, range.end), kind: range.kind });
    cursor = range.end;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), kind: null });
  return segments;
}
