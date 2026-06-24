/**
 * GET /api/seo/cannibalization/latest — most recent persisted snapshot
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cannibalization_snapshots")
    .select("*")
    .eq("tenant_id", await resolveTenantId())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ snapshot: data?.[0] ?? null });
}
