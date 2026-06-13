/**
 * GET /api/community/youtube/scan
 *
 * Searches recent employment-law videos on YouTube, fetches top comments
 * on the highest-viewed ones, and returns relevant comment threads worth
 * engaging with.
 *
 * Requires YOUTUBE_API_KEY env var (free Google API; ~600 quota units per
 * scan against a 10K daily cap).
 */

import { NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { scanYouTube } from "@/lib/youtube-scanner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    const result = await scanYouTube();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scan failed";
    const status = msg.includes("YOUTUBE_API_KEY") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
