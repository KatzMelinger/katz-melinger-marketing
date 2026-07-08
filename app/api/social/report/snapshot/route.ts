/**
 * Monthly social-metrics snapshot — freezes a month's per-platform figures into
 * social_metrics_snapshots so the Monthly Report can trend month-over-month
 * stably (the live Metricool dashboards keep no history).
 *
 * GET  /api/social/report/snapshot — Vercel Cron (Bearer CRON_SECRET). Snapshots
 *      the month that just ended (the prior calendar month), so scheduling it on
 *      the 1st captures the previous month in full.
 * POST /api/social/report/snapshot — manual trigger for the current tenant.
 *      Body: { "month": "YYYY-MM" } (optional; defaults to the prior month).
 */

import { NextRequest, NextResponse } from "next/server";

import { currentMonthKey, priorMonthKey, snapshotMonth } from "@/lib/social-report";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { DEFAULT_TENANT_ID, resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MONTH_RE = /^\d{4}-\d{2}$/;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  const period = priorMonthKey(currentMonthKey());
  try {
    const result = await snapshotMonth(supabase, DEFAULT_TENANT_ID, period);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }

  let month = priorMonthKey(currentMonthKey());
  try {
    const body = (await req.json()) as { month?: unknown };
    if (typeof body.month === "string" && MONTH_RE.test(body.month)) month = body.month;
  } catch {
    // no/invalid body → default to prior month
  }

  try {
    const tenantId = await resolveTenantId();
    const result = await snapshotMonth(supabase, tenantId, month);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
