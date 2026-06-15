/**
 * GET /api/leads/leakage — lead-response leakage report for the current tenant.
 *
 * Query params (all optional):
 *   ?days=90                 — lookback window (default 90, max 365)
 *   ?since=YYYY-MM-DD        — explicit start (overrides days)
 *   ?until=YYYY-MM-DD        — explicit end
 *   ?avg_case_value=7500     — override the dollarization input
 *   ?sign_rate=0.25          — override expected lead→signed rate (0–1)
 *
 * Case value + sign rate default to the average across public.ad_economics,
 * falling back to conservative constants when none are set. Compute logic lives
 * in lib/lead-response-server.ts (shared with the weekly snapshot cron).
 */

import { NextRequest, NextResponse } from "next/server";

import { computeLeadResponse } from "@/lib/lead-response-server";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

function clampDays(raw: string | null): number {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 90;
  return Math.max(1, Math.min(365, Math.floor(n)));
}

function parseNum(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  const tid = await resolveTenantId();
  const sp = req.nextUrl.searchParams;

  const sinceParam = sp.get("since");
  const untilParam = sp.get("until");
  let sinceISO: string;
  if (sinceParam) {
    sinceISO = `${sinceParam}T00:00:00`;
  } else {
    const d = new Date();
    d.setDate(d.getDate() - clampDays(sp.get("days")));
    sinceISO = d.toISOString();
  }

  try {
    const report = await computeLeadResponse(supabase, tid, {
      sinceISO,
      untilDate: untilParam,
      avgCaseValueOverride: parseNum(sp.get("avg_case_value")),
      signRateOverride: parseNum(sp.get("sign_rate")),
    });
    return NextResponse.json({ report, window: { since: sinceISO, until: untilParam ?? null } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "compute failed" }, { status: 500 });
  }
}
