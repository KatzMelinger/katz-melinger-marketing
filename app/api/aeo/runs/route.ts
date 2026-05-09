/**
 * GET /api/aeo/runs
 *
 * Lists the most recent AEO runs (newest first), with summary counts.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("aeo_runs")
    .select("id, status, providers, prompt_count, response_count, failure_count, started_at, completed_at, triggered_by, error, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
