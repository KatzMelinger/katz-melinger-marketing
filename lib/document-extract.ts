/**
 * Shared text extraction for uploaded documents.
 *
 * Used by /api/content/sources and /api/content/brand-documents so both
 * upload paths accept the same range of file types and apply the same
 * normalization.
 *
 * Supported:
 *   .pdf          via pdf-parse (PDFParse v2)
 *   .docx         via mammoth (extracts .docx; .doc is NOT supported by
 *                 mammoth — re-save legacy .doc as .docx first)
 *   .txt / .md    treat the buffer as UTF-8 text
 *   .html / .htm  strip tags down to text
 *   .rtf          strip RTF control words / groups down to text
 *
 * Anything else falls back to a UTF-8 decode attempt with an empty-string
 * guard. The caller decides how to handle empty extractions.
 */

import { Buffer } from "node:buffer";

export type ExtractResult = {
  text: string;
  format: "pdf" | "docx" | "text" | "markdown" | "html" | "rtf" | "unknown";
};

export const SUPPORTED_UPLOAD_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".rtf",
] as const;

export const SUPPORTED_UPLOAD_ACCEPT = SUPPORTED_UPLOAD_EXTENSIONS.join(",");

export function isSupportedUpload(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripRtf(rtf: string): string {
  // Drop the rtf header / control words / groups / hex escapes; what's left
  // is the visible text. Good enough for short brand/sample docs — won't
  // preserve formatting or recover embedded objects.
  return rtf
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'[0-9a-f]{2}/gi, " ")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // pdf-parse v2 exports a PDFParse class instead of a default function.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => p.text).join("\n");
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  // mammoth handles .docx (zip+xml) cleanly. It does NOT handle legacy .doc.
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

export async function extractText(args: {
  filename: string;
  buffer: Buffer;
}): Promise<ExtractResult> {
  const lower = args.filename.toLowerCase();

  if (lower.endsWith(".pdf")) {
    return { text: await extractPdf(args.buffer), format: "pdf" };
  }
  if (lower.endsWith(".docx")) {
    return { text: await extractDocx(args.buffer), format: "docx" };
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return { text: args.buffer.toString("utf-8"), format: "markdown" };
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return { text: stripHtml(args.buffer.toString("utf-8")), format: "html" };
  }
  if (lower.endsWith(".rtf")) {
    return { text: stripRtf(args.buffer.toString("utf-8")), format: "rtf" };
  }
  if (lower.endsWith(".txt")) {
    return { text: args.buffer.toString("utf-8"), format: "text" };
  }

  // Unknown extension — attempt a utf-8 decode and let the caller decide.
  return { text: args.buffer.toString("utf-8"), format: "unknown" };
}
