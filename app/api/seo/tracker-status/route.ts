/**
 * GET /api/seo/tracker-status
 *
 * Lightweight freshness read for the SEO Ops Hub's "Rank tracker" KPI tile —
 * the same SEO_STALE_HOURS threshold the D5 alert (lib/alerts-engine.ts) uses
 * to decide whether to raise a "tracker stale" alert, surfaced here so the
 * hub shows it passively on every page load rather than depending on someone
 * having opened /alerts.
 */

import { NextResponse } from "next/server";

import { getTenantConfig } from "@/lib/tenant-config";
import { getTenantJobDb } from "@/lib/tenant-db";
import { SEO_STALE_HOURS } from "@/lib/alerts-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { tenantId } = await getTenantConfig();
    const db = getTenantJobDb(tenantId);
    const { data } = await db
      .select("seo_rank_snapshots", "created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastSnapshotAt = (data as { created_at?: string } | null)?.created_at ?? null;
    const ageHours = lastSnapshotAt
      ? Math.round((Date.now() - new Date(lastSnapshotAt).getTime()) / 3600_000)
      : null;
    const stale = ageHours === null || ageHours > SEO_STALE_HOURS;

    return NextResponse.json({ lastSnapshotAt, ageHours, stale });
  } catch {
    // A status check failing should read as "unknown", not crash the hub.
    return NextResponse.json({ lastSnapshotAt: null, ageHours: null, stale: true });
  }
}
