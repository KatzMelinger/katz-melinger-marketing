/**
 * GET /api/social/analytics/account — latest account-level social totals (4B).
 *
 * Reads the snapshot lib/social-account-analytics.ts stores on the 6-hourly
 * metrics-refresh cron. Read-only: it never calls Ayrshare itself, so opening a
 * dashboard can't burn API calls or block on a slow vendor response. Use
 * POST /api/social/metrics/refresh to force a fresh pull.
 */

import { NextResponse } from "next/server";

import { nativeSocialAnalyticsEnabled } from "@/lib/feature-flags";
import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMPTY = { fetchedAt: null, platforms: {}, lastUpdated: {} };

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  if (!nativeSocialAnalyticsEnabled()) {
    return NextResponse.json({ enabled: false, snapshot: EMPTY });
  }

  try {
    const db = await getTenantDb();
    const { data } = await db.from("social_insights").select("account_analytics").maybeSingle();
    const raw = data?.account_analytics;
    const snapshot = raw && typeof raw === "object" && Object.keys(raw).length > 0 ? raw : EMPTY;
    return NextResponse.json({ enabled: true, snapshot });
  } catch {
    return NextResponse.json({ enabled: true, snapshot: EMPTY });
  }
}
