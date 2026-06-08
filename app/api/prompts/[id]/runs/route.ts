/**
 * GET /api/prompts/[id]/runs — list run history (newest first)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_prompt_runs")
    .select("id, variables, output, input_tokens, output_tokens, cost_estimate, latency_ms, status, error, created_at")
    .eq("tenant_id", await resolveTenantId())
    .eq("prompt_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
