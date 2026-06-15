/**
 * PATCH  /api/aeo/targets/[id]   — update fields
 * DELETE /api/aeo/targets/[id]   — remove
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
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "domain", "aliases"]) {
    if (key in (body ?? {})) patch[key] = body[key];
  }
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("aeo_targets")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
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
  const { supabase, tenantId } = await getTenantClient();
  const { error } = await supabase
    .from("aeo_targets")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
