/**
 * PATCH /api/alerts/[id]
 *   body: { status: "new" | "read" | "dismissed" }
 *
 * Used by the inbox to mark items read or dismissed.
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
  const status = body?.status as string | undefined;
  if (!status || !["new", "read", "dismissed"].includes(status)) {
    return NextResponse.json({ error: "status must be new|read|dismissed" }, { status: 400 });
  }
  const patch: Record<string, unknown> = { status };
  if (status === "read") patch.read_at = new Date().toISOString();
  if (status === "dismissed") patch.dismissed_at = new Date().toISOString();

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("marketing_alerts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
