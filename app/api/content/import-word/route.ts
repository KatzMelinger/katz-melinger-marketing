/**
 * POST /api/content/import-word   (multipart: file, fallbackTitle?, targetKeyword?)
 *
 * Item 10. Turn a .docx into structured Markdown the draft editor can hold,
 * with its headings, bold, italics and lists intact.
 *
 * Returns the Markdown; it does not write it anywhere. The caller decides where
 * it lands, and the person pasting a blog into a draft gets to look at it
 * before it replaces what is there.
 *
 * Also handles a pasted HTML fragment (`html` field) so the editor's paste
 * handler and the file import go through exactly one conversion — two code
 * paths producing different Markdown from the same document is how "it works
 * when I import but not when I paste" starts.
 */

import { NextResponse } from "next/server";

import { htmlToMarkdown, normalizeHeadings } from "@/lib/html-to-markdown";
import { importWordDocument } from "@/lib/word-import";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Word documents are text; a blog that does not fit in this is not a blog. */
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  }

  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const fallbackTitle = str("fallbackTitle");
  const targetKeyword = str("targetKeyword");

  // The paste path: an HTML fragment straight off the clipboard.
  const html = str("html");
  if (html) {
    const md = htmlToMarkdown(html);
    if (!md.trim()) {
      return NextResponse.json(
        { error: "Nothing usable in that paste — try the Word file instead." },
        { status: 422 },
      );
    }
    const normalized = normalizeHeadings(md, { fallbackTitle, targetKeyword });
    return NextResponse.json({ ok: true, markdown: normalized.markdown, warnings: normalized.warnings });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return NextResponse.json(
      {
        error:
          file.name.toLowerCase().endsWith(".doc")
            ? "Legacy .doc files can't be read. Open it in Word and Save As .docx."
            : "Only .docx files can be imported.",
      },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is larger than 10MB." }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const out = await importWordDocument({ buffer, fallbackTitle, targetKeyword });
    if (!out.markdown.trim()) {
      return NextResponse.json(
        { error: out.warnings[0] ?? "That document appears to be empty." },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, markdown: out.markdown, warnings: out.warnings });
  } catch (e) {
    console.warn("[import-word] failed:", e);
    return NextResponse.json(
      { error: "Couldn't read that document. If it was made by another program, re-save it from Word." },
      { status: 422 },
    );
  }
}
