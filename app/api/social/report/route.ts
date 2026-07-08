/**
 * GET /api/social/report?month=YYYY-MM — Monthly social report data.
 *
 * Returns per-platform metrics for the requested month plus month-over-month
 * deltas vs the prior month. Reads frozen figures from social_metrics_snapshots
 * when present and falls back to a live Metricool query for any month not yet
 * snapshotted (e.g. the current, in-progress month), so the report renders
 * before the first snapshot cron has run. Defaults to the current month.
 */

import { NextRequest, NextResponse } from "next/server";

import { buildMonthlyReport, currentMonthKey } from "@/lib/social-report";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MONTH_RE = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;

  const requested = req.nextUrl.searchParams.get("month");
  const month = requested && MONTH_RE.test(requested) ? requested : currentMonthKey();

  try {
    const tenantId = await resolveTenantId();
    // Service-role client is optional here: buildMonthlyReport falls back to a
    // live Metricool compute when it's null or a month has no snapshot.
    const supabase = getSupabaseServer();
    const report = await buildMonthlyReport(supabase, tenantId, month);
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ connected: false, error: message, month, platforms: [] });
  }
}
