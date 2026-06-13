/**
 * GET /api/community/news/scan
 *
 * Pulls Google News RSS for NY/NJ employment-law headlines. Use these as
 * news pegs for reactive content (blog posts, social posts).
 */

import { NextResponse } from "next/server";
import { scanNews } from "@/lib/news-scanner";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    const result = await scanNews();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
