/**
 * PATCH  /api/aeo/prompts/[id]   — update fields (enabled, prompt, etc)
 * DELETE /api/aeo/prompts/[id]   — remove
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["prompt", "category", "intent", "geography", "enabled", "notes"]) {
    if (key in (body ?? {})) patch[key] = body[key];
  }
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("aeo_prompts")
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
  const { supabase } = await getTenantClient();
  const { error } = await supabase.from("aeo_prompts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
