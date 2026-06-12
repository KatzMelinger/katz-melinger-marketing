/**
 * Weekly lead-response snapshot — persists point-in-time leakage metrics so the
 * number can be trended (the rest of the app is snapshot-only). One row per
 * (tenant, snapshot_date, window_days); re-running the same day overwrites.
 *
 * GET  /api/leads/leakage/snapshot — Vercel Cron trigger (Bearer CRON_SECRET).
 * POST /api/leads/leakage/snapshot — manual trigger for the current tenant.
 *
 * Uses a fixed 30-day trailing window so week-over-week values are comparable.
 * Recovery for the most-recent days is necessarily truncated at the window
 * edge, but that bias is constant across snapshots, so the trend is valid.
 */

import { NextRequest, NextResponse } from "next/server";

import { computeLeadResponse } from "@/lib/lead-response-server";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase-server";
import { DEFAULT_TENANT_ID, resolveTenantId } from "@/lib/tenant-context";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const WINDOW_DAYS = 30;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

async function writeSnapshot(supabase: SupabaseClient, tenantId: string): Promise<NextResponse> {
  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS);
  const today = new Date().toISOString().slice(0, 10);

  let report;
  try {
    report = await computeLeadResponse(supabase, tenantId, { sinceISO: since.toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "compute failed" }, { status: 500 });
  }

  const { error } = await supabase.from("lead_response_snapshots").upsert(
    {
      tenant_id: tenantId,
      snapshot_date: today,
      window_days: WINDOW_DAYS,
      total_leads: report.totalLeads,
      leads_connected: report.leadsConnected,
      connect_rate_pct: report.connectRatePct,
      missed_first_contact: report.missedFirstContact,
      recovered: report.recovered,
      lost: report.lost,
      first_time_caller_lost: report.firstTimeCallerLost,
      after_hours_lost: report.afterHoursLost,
      estimated_lost_value: report.estimatedLostValue,
    },
    { onConflict: "tenant_id,snapshot_date,window_days" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    snapshot_date: today,
    window_days: WINDOW_DAYS,
    lost: report.lost,
    estimated_lost_value: report.estimatedLostValue,
  });
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return writeSnapshot(getSupabaseAdmin(), DEFAULT_TENANT_ID);
}

export async function POST() {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  return writeSnapshot(supabase, await resolveTenantId());
}
