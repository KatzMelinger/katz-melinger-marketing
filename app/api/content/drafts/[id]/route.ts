/**
 * GET    /api/content/drafts/[id]   — fetch a single draft (with latest analysis)
 * PATCH  /api/content/drafts/[id]   — update title, body, metadata, status
 * DELETE /api/content/drafts/[id]   — remove
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("content_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: analyses } = await supabase
    .from("content_analyses")
    .select("*")
    .eq("draft_id", id)
    .order("created_at", { ascending: false })
    .limit(1);

  return NextResponse.json({ draft: data, latest_analysis: analyses?.[0] ?? null });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["title", "body", "metadata", "status", "practice_area"]) {
    if (key in (body ?? {})) patch[key] = body[key];
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("content_drafts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("content_drafts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
