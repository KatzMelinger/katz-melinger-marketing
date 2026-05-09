/**
 * GET  /api/content/drafts          — list recent drafts (paginated)
 *   query: ?format=blog|linkedin|...&limit=50
 *
 * POST /api/content/drafts          — manually create / autosave a draft
 *   body: { format, topic, title?, body, metadata?, practiceArea?, seoBrief?, sourceId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const format = searchParams.get("format");
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("content_drafts")
    .select("id, batch_id, format, template, topic, practice_area, title, body, metadata, status, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (format) q = q.eq("format", format);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ drafts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body?.format || !body?.topic || !body?.body) {
    return NextResponse.json({ error: "format, topic, body required" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("content_drafts")
    .insert({
      format: body.format,
      template: body.template ?? null,
      topic: body.topic,
      title: body.title ?? null,
      body: body.body,
      metadata: body.metadata ?? {},
      practice_area: body.practiceArea ?? null,
      seo_brief: body.seoBrief ?? null,
      source_id: body.sourceId ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
