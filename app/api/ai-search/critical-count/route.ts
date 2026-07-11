/**
 * GET /api/ai-search/critical-count
 *
 * Returns just the count of critical issues from the latest AI-search readiness
 * scan — a lightweight signal for the dashboard alert strip, so the client
 * never has to pull the full (large) scan `analysis` JSON just to show a number.
 *
 * Sourced from the real `ai_search_scans.analysis.criticalIssues` array (the
 * Claude-analyzed crawl), NOT the mock `technical_seo_runs.crawl_errors`.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_search_scans")
    .select("id, analysis, created_at")
    .eq("tenant_id", await resolveTenantId())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ hasScan: false, count: 0, scannedAt: null });
  }

  const issues = (data.analysis as { criticalIssues?: unknown[] } | null)?.criticalIssues;
  const count = Array.isArray(issues) ? issues.length : 0;
  return NextResponse.json({
    hasScan: true,
    count,
    scannedAt: (data.created_at as string | null) ?? null,
  });
}
