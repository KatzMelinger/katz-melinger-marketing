/**
 * POST /api/recommendations/generate
 *
 * Asks Claude to read the firm's most recent SEO + AEO + cannibalization data
 * and produce a prioritized action list. Single round-trip — fast enough to
 * run on demand from the dashboard.
 */

import { NextResponse } from "next/server";
import { generateRecommendations } from "@/lib/ai-recommendations";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await generateRecommendations();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "generate failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
