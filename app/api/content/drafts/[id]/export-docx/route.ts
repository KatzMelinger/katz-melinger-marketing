/**
 * GET /api/content/drafts/[id]/export-docx
 *
 * Generates a Word document for the draft and streams it as the response.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { buildDraftDocx, suggestFilename } from "@/lib/content-export-docx";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("content_drafts")
    .select("format, topic, title, body, metadata, practice_area, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const draft = {
    format: data.format as string,
    topic: data.topic as string,
    title: data.title as string | null,
    body: data.body as string,
    metadata: (data.metadata as Record<string, unknown> | null) ?? {},
    practiceArea: data.practice_area as string | null,
    createdAt: data.created_at as string | null,
  };
  const buffer = await buildDraftDocx(draft);
  const filename = suggestFilename(draft);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
