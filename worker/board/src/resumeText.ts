/**
 * 简历文件 → 文字。全在你的浏览器里做：原文件不上传，只有你核对过的文字才存到云端。
 * PDF 用 pdf.js、Word（.docx）用 mammoth，都是用到时才加载（不拖慢看板打开）。
 */

export const RESUME_ACCEPT = ".pdf,.docx,.txt,.md";

/** 合并多余的空白，保留分行。 */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    // 中文字体要 cmaps 才认得出字（构建时从 pdfjs-dist 拷过来，见 vite.config.ts）
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 10); i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      }
    }
    if (line.length > 0) lines.push(line);
    pages.push(lines.join("\n"));
  }
  await doc.destroy();
  return pages.join("\n\n");
}

async function docxText(data: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: data });
  return result.value;
}

/** 认得的格式提取文字；认不得、或提取不出字（扫描件）时抛出说明。 */
export async function resumeFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.size > 10 * 1024 * 1024) throw new Error("文件太大了（超过 10MB）");
  let text: string;
  if (name.endsWith(".pdf")) text = await pdfText(await file.arrayBuffer());
  else if (name.endsWith(".docx")) text = await docxText(await file.arrayBuffer());
  else if (name.endsWith(".txt") || name.endsWith(".md")) text = await file.text();
  else throw new Error("只认 PDF、Word（.docx）、TXT；其他格式请直接粘贴文字");
  const tidy = tidyText(text);
  if (tidy.length < 20) throw new Error("这个文件里提取不出文字（可能是扫描件或图片），请直接粘贴文字");
  return tidy;
}
