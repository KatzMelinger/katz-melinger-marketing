/**
 * GET /api/community/hackernews/scan
 *
 * Searches Hacker News (via Algolia, no key needed) for employment-related
 * threads relevant to a NY/NJ plaintiff-side firm.
 */

import { NextResponse } from "next/server";
import { scanHackerNews } from "@/lib/hn-scanner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    const result = await scanHackerNews();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
