/**
 * POST /api/content/drafts/import
 *
 * Bring a draft written outside the system into content_drafts so the
 * existing analysis pipeline (Readability / AEO / Brand voice / CASH) can
 * score it like any AI-generated draft. Two body shapes:
 *
 * application/json:
 *   { format, topic, title?, body, practiceArea?, targetKeywords?: string[] }
 *
 * multipart/form-data:
 *   - file (binary; pdf / docx / txt / md / rtf / html)
 *   - format, topic, title?, practiceArea?, targetKeywords?
 *
 * Each imported draft is tagged with metadata.origin_source = "imported"
 * (and the source filename if a file was provided) so the drafts library
 * shows where the content came from.
 *
 * Returns { draft_id }. The client redirects to /content/drafts?id=... and
 * fires the analyze endpoint there.
 */

import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";

import { extractText, isSupportedUpload, SUPPORTED_UPLOAD_EXTENSIONS } from "@/lib/document-extract";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_FORMATS = [
  "blog",
  "linkedin",
  "twitter",
  "facebook",
  "instagram",
  "email",
  "podcast",
] as const;
type ValidFormat = (typeof VALID_FORMATS)[number];

function isValidFormat(v: unknown): v is ValidFormat {
  return typeof v === "string" && (VALID_FORMATS as readonly string[]).includes(v);
}

function readTargetKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim());
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

async function insertDraft(args: {
  format: ValidFormat;
  template: string | null;
  formatOptionLabel: string | null;
  topic: string;
  title: string | null;
  body: string;
  practiceArea: string | null;
  targetKeywords: string[];
  importedFilename: string | null;
  importedFormat: string | null;
}): Promise<{ draftId: string } | { error: string; status: number }> {
  const trimmedBody = args.body.trim();
  if (!trimmedBody) {
    return { error: "No body content to import.", status: 400 };
  }

  const metadata: Record<string, unknown> = {
    origin_source: "imported",
    origin_context: {
      ...(args.formatOptionLabel ? { page_type: args.formatOptionLabel } : {}),
      ...(args.importedFilename ? { filename: args.importedFilename } : {}),
      ...(args.importedFormat ? { extracted_from: args.importedFormat } : {}),
      imported_at: new Date().toISOString(),
    },
  };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("content_drafts")
    .insert({
      format: args.format,
      template: args.template,
      topic: args.topic,
      title: args.title,
      body: trimmedBody,
      metadata,
      practice_area: args.practiceArea,
      seo_brief: args.targetKeywords.length > 0 ? { targetKeywords: args.targetKeywords } : null,
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message, status: 500 };
  }
  return { draftId: data.id as string };
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      const format = body?.format;
      const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
      const text = typeof body?.body === "string" ? body.body : "";

      if (!isValidFormat(format)) {
        return NextResponse.json(
          { error: `format must be one of: ${VALID_FORMATS.join(", ")}` },
          { status: 400 },
        );
      }
      if (!topic) {
        return NextResponse.json({ error: "topic required" }, { status: 400 });
      }
      if (!text.trim()) {
        return NextResponse.json({ error: "body required" }, { status: 400 });
      }

      const result = await insertDraft({
        format,
        template:
          typeof body?.template === "string" && body.template.trim()
            ? body.template.trim()
            : null,
        formatOptionLabel:
          typeof body?.formatOptionLabel === "string" && body.formatOptionLabel.trim()
            ? body.formatOptionLabel.trim()
            : null,
        topic,
        title: typeof body?.title === "string" && body.title.trim() ? body.title.trim() : null,
        body: text,
        practiceArea:
          typeof body?.practiceArea === "string" && body.practiceArea.trim()
            ? body.practiceArea.trim()
            : null,
        targetKeywords: readTargetKeywords(body?.targetKeywords),
        importedFilename: null,
        importedFormat: "paste",
      });

      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({ draft_id: result.draftId });
    }

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file field required" }, { status: 400 });
      }
      if (!isSupportedUpload(file.name)) {
        return NextResponse.json(
          {
            error: `Unsupported file type. Supported: ${SUPPORTED_UPLOAD_EXTENSIONS.join(", ")}.`,
          },
          { status: 400 },
        );
      }

      const formatRaw = form.get("format");
      const format = isValidFormat(formatRaw) ? formatRaw : "blog";
      const topicRaw = form.get("topic");
      const topic = typeof topicRaw === "string" ? topicRaw.trim() : "";
      if (!topic) {
        return NextResponse.json({ error: "topic required" }, { status: 400 });
      }

      const titleRaw = form.get("title");
      const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : null;
      const practiceAreaRaw = form.get("practiceArea");
      const practiceArea =
        typeof practiceAreaRaw === "string" && practiceAreaRaw.trim()
          ? practiceAreaRaw.trim()
          : null;
      const targetKeywords = readTargetKeywords(form.get("targetKeywords"));

      const buffer = Buffer.from(await file.arrayBuffer());
      const extracted = await extractText({ filename: file.name, buffer });
      const text = (extracted.text ?? "").trim();
      if (!text) {
        return NextResponse.json(
          { error: "Could not extract any text from the file." },
          { status: 400 },
        );
      }

      const templateRaw = form.get("template");
      const template =
        typeof templateRaw === "string" && templateRaw.trim() ? templateRaw.trim() : null;
      const labelRaw = form.get("formatOptionLabel");
      const formatOptionLabel =
        typeof labelRaw === "string" && labelRaw.trim() ? labelRaw.trim() : null;

      const result = await insertDraft({
        format,
        template,
        formatOptionLabel,
        topic,
        title,
        body: text,
        practiceArea,
        targetKeywords,
        importedFilename: file.name,
        importedFormat: extracted.format,
      });

      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({ draft_id: result.draftId });
    }

    return NextResponse.json(
      { error: "Unsupported content type — send JSON or multipart/form-data." },
      { status: 415 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
