/**
 * GET /api/llms-txt/versions — recent generated versions for diffing
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("llms_txt_versions")
    .select("id, domain, content, source_pages, created_at")
    .eq("tenant_id", await resolveTenantId())
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ versions: data ?? [] });
}
