/**
 * GET    /api/content/sources/[id]   — full content + review
 * DELETE /api/content/sources/[id]   — remove
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("content_sources")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase } = await getTenantClient();
  const { error } = await supabase.from("content_sources").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
