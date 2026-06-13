/**
 * GET /api/seo/rank-history
 *
 * Serves the position-history time-series for the Semrush-style "Position
 * Tracking" view: a visibility trend line per domain (firm + competitors) and
 * the per-keyword ranks needed for date-over-date comparison columns.
 *
 * Backed by seo_rank_snapshots, which the daily tracked-keyword refresh cron
 * appends to. Read-only — no DataForSEO spend here.
 */

import { NextResponse } from "next/server";
import { getTenantDb } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";
import { shapeRankHistory, type RankSnapshotRow } from "@/lib/rank-history";

export const runtime = "nodejs";

// Keep the window bounded so the payload stays small as history accumulates.
const HISTORY_DAYS = 180;

export async function GET() {
  try {
    const db = await getTenantDb();
    const { semrushDomain } = await getTenantConfig(db.tenantId);

    const cutoff = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { data, error } = await db
      .from("seo_rank_snapshots")
      .select("keyword, domain, rank, captured_on")
      .gte("captured_on", cutoff)
      .order("captured_on", { ascending: true });

    if (error) {
      console.error("[seo/rank-history] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to load rank history" }, { status: 500 });
    }

    return NextResponse.json(
      shapeRankHistory((data ?? []) as RankSnapshotRow[], semrushDomain),
    );
  } catch (err) {
    console.error(
      "[seo/rank-history] Failed:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json({ error: "Failed to load rank history" }, { status: 500 });
  }
}
