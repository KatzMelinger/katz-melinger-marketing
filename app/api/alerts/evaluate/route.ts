/**
 * POST /api/alerts/evaluate
 *
 * Manual trigger for the SEO/AEO alert evaluators. The AEO evaluator runs
 * automatically after each sweep, so this is mostly useful for the rank-drop
 * evaluator (which reads the keyword refresh table) and for re-checking after
 * threshold tweaks.
 */

import { NextResponse } from "next/server";
import { evaluateRankAlerts } from "@/lib/alerts-engine";

export const runtime = "nodejs";

export async function POST() {
  try {
    const ranks = await evaluateRankAlerts();
    return NextResponse.json({ rank: ranks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "evaluate failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
