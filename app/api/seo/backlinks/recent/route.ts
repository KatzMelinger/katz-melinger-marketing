/**
 * GET /api/seo/backlinks/recent
 *   ?sort=new|lost    default: new (sorted by first_seen desc)
 *   ?limit=N          default: 50, max 200
 *
 * Powers the "New (30d)" and "Lost (30d)" drill-down panels on the
 * backlinks page. "Lost" is a proxy — Semrush doesn't expose a dedicated
 * lost-backlinks endpoint on this plan, so we sort by last_seen ascending
 * to surface the backlinks the crawler hasn't refreshed recently.
 */

import { NextRequest, NextResponse } from "next/server";

import { getRecentBacklinks } from "@/lib/seo-intelligence";
import { getTenantConfig } from "@/lib/tenant-config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sortParam = req.nextUrl.searchParams.get("sort") ?? "new";
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const sort = sortParam === "lost" ? "last_seen_asc" : "first_seen_desc";
  try {
    const { semrushDomain } = await getTenantConfig();
    const backlinks = await getRecentBacklinks(semrushDomain, { sort, limit: limitParam });
    return NextResponse.json({ sort: sortParam, backlinks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch recent backlinks" },
      { status: 500 },
    );
  }
}
