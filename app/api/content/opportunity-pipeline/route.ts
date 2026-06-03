/**
 * POST /api/content/opportunity-pipeline
 *   Body: { practiceArea?, competitor?, topN?, maxCandidates?, deep? }
 *
 * Runs the full Opportunity → Brief pipeline: source Semrush opportunities →
 * validate with real trend data + score → research-packet (legal + PAA) + brief
 * the top winners. Returns a ranked report. Heavy (Claude + connectors), so it
 * deep-processes only the top `topN` (default 3).
 */

import { NextRequest, NextResponse } from "next/server";

import { runOpportunityPipeline } from "@/lib/opportunity-pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await runOpportunityPipeline({
      practiceArea:
        typeof body.practiceArea === "string" ? body.practiceArea : null,
      competitor: typeof body.competitor === "string" ? body.competitor : null,
      topN: typeof body.topN === "number" ? body.topN : undefined,
      maxCandidates:
        typeof body.maxCandidates === "number" ? body.maxCandidates : undefined,
      deep: body.deep === false ? false : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "pipeline failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
