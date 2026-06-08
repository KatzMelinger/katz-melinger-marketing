/**
 * GET /api/aeo/runs
 *
 * Lists the most recent AEO runs (newest first), with summary counts.
 */

import { NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

export async function GET() {
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("aeo_runs")
    .select("id, status, providers, prompt_count, response_count, failure_count, started_at, completed_at, triggered_by, error, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
