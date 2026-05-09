/**
 * GET  /api/content/sources             — list recent sources
 * POST /api/content/sources             — ingest a new source
 *   For text/url:  Content-Type: application/json
 *     { source_type: "text" | "url", text?, url?, notes? }
 *   For file:      Content-Type: multipart/form-data
 *     fields: file (binary), notes (optional)
 *
 * Returns the saved source row + AI review summary.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { ingestSource } from "@/lib/content-source";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("content_sources")
    .select("id, source_type, filename, url, word_count, notes, review_summary, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources: data ?? [] });
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body?.source_type === "text") {
        if (!body?.text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
        const result = await ingestSource({ source_type: "text", text: body.text, notes: body.notes });
        return NextResponse.json(result);
      }
      if (body?.source_type === "url") {
        if (!body?.url) return NextResponse.json({ error: "url required" }, { status: 400 });
        const result = await ingestSource({ source_type: "url", url: body.url, notes: body.notes });
        return NextResponse.json(result);
      }
      return NextResponse.json({ error: "source_type must be text|url|file" }, { status: 400 });
    }

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file field required" }, { status: 400 });
      }
      const notes = (form.get("notes") as string | null) ?? undefined;
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await ingestSource({
        source_type: "file",
        filename: file.name,
        fileBuffer: buffer,
        notes,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ingest failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
