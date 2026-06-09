/**
 * GET /api/aeo/runs/[id]
 *
 * Returns the status row for a single run (used for poll-while-running).
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
    .from("aeo_runs")
    .select("id, status, providers, prompt_count, response_count, failure_count, started_at, completed_at, triggered_by, error, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
