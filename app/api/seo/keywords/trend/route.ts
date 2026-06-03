/**
 * GET /api/seo/keywords/trend?keyword=…
 *   Real 12-month search-interest trend for a keyword from Semrush (Td column).
 *   Returns { keyword, searchVolume, trend: number[], direction }.
 *   This is the legitimate trend signal — the /content/intelligence/trends
 *   endpoint is AI-suggested, not live data.
 */

import { NextRequest, NextResponse } from "next/server";

import { getKeywordTrend } from "@/lib/semrush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const keyword = req.nextUrl.searchParams.get("keyword")?.trim();
  if (!keyword) {
    return NextResponse.json({ error: "keyword query param required" }, { status: 400 });
  }
  try {
    const result = await getKeywordTrend(keyword);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "trend lookup failed" },
      { status: 500 },
    );
  }
}
