/**
 * PATCH /api/alerts/rules/[id]
 *   body: { enabled?, threshold?, notes? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const key of ["enabled", "threshold", "notes"]) {
    if (key in (body ?? {})) patch[key] = body[key];
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("marketing_alert_rules")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
