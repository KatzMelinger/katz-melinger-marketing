/**
 * GET /api/keyword-research/history?type=<discover|expand|competitor-gaps>&limit=10
 *
 * Returns the most recent completed jobs for a given type. Used by the
 * "Recent" dropdown in each keyword research tab to let the user revisit
 * past results without re-running the AI generation.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 10;

const VALID_TYPES = ["discover", "expand", "competitor-gaps"] as const;

export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type");
    const limitParam = req.nextUrl.searchParams.get("limit");

    if (!type || !VALID_TYPES.includes(type as any)) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    const limit = Math.min(Math.max(parseInt(limitParam || "10", 10) || 10, 1), 50);

    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 },
      );
    }

    const { data, error } = await supabase
      .from("keyword_research_jobs")
      .select("id, request_params, result, completed_at, started_at")
      .eq("job_type", type)
      .eq("status", "done")
      .order("completed_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch history: ${error.message}`);
    }

    return NextResponse.json({ jobs: data || [] });
  } catch (err: any) {
    console.error("[keyword-research/history] Failed:", err?.message);
    return NextResponse.json(
      { error: err?.message || "Failed to fetch history" },
      { status: 500 },
    );
  }
}