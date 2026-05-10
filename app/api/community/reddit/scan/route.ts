/**
 * GET /api/community/reddit/scan
 *
 * Scans curated subreddits via public Atom RSS feeds, scores posts for
 * relevance to NY/NJ employment law, returns the top hits.
 */

import { NextResponse } from "next/server";
import { scanReddit } from "@/lib/community-scanner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    const result = await scanReddit();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
