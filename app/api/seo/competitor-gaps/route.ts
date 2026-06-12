/**
 * GET /api/seo/competitor-gaps?limit=30
 *
 * Keywords your tracked competitors rank for that you don't (or rank worse on).
 * The heavy lifting already lives in lib/seo-intelligence — this route just
 * resolves the tenant's tracked competitor domains and runs the gap analysis
 * across all of them, returning the merged, opportunity-sorted list.
 *
 * Tracked competitors are managed on /seo/competitors. With none tracked the
 * gap list is empty and the page nudges the user there.
 */

import { NextRequest, NextResponse } from "next/server";

import { listCompetitors } from "@/lib/seo-competitors";
import { getKeywordGapVsCompetitors } from "@/lib/seo-intelligence";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const limitParam = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 30;

    const competitors = await listCompetitors();
    if (competitors.length === 0) {
      return NextResponse.json({ competitors: [], gaps: [] });
    }

    const gaps = await getKeywordGapVsCompetitors(competitors, undefined, limit);

    return NextResponse.json({ competitors, gaps });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed competitor gap analysis" },
      { status: 500 },
    );
  }
}
