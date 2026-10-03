/**
 * Call scoring runs through the Anthropic Message Batches API (half price).
 * See lib/call-score-batch.ts.
 *
 * GET /api/calls/score-pending?mode=submit  — Vercel Cron, nightly: queue one
 *   batch with every call that needs a (re)score since SCORING_SINCE.
 * GET /api/calls/score-pending?mode=collect — Vercel Cron, hourly (no model
 *   cost): save results from finished batches and attribute each call.
 *   Both require `Authorization: Bearer ${CRON_SECRET}`.
 *
 * POST /api/calls/score-pending — the Calls page "Score pending" button:
 *   collects anything finished, then queues the rest right away instead of
 *   waiting for the night.
 *
 * One-off immediate scoring at full price is POST /api/calls/[id]/score.
 */
import { NextRequest, NextResponse } from "next/server";

import { collectScoringBatches, submitScoringBatch } from "@/lib/call-score-batch";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Leave headroom under maxDuration; an unfinished collection resumes next hour. */
const COLLECT_BUDGET_MS = 240_000;

/**
 * Vercel injects `Authorization: Bearer ${CRON_SECRET}` on scheduled
 * invocations when CRON_SECRET is set. Reject anything else so the cron URL
 * can't be abused to burn Anthropic credits.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

function errorResponse(e: unknown) {
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Cron has no user session — use the admin client (service role).
  const supabase = getSupabaseAdmin();
  try {
    if (req.nextUrl.searchParams.get("mode") === "submit") {
      return NextResponse.json(await submitScoringBatch(supabase));
    }
    return NextResponse.json(await collectScoringBatches(supabase, COLLECT_BUDGET_MS));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseAdmin();
  try {
    const collected = await collectScoringBatches(supabase, COLLECT_BUDGET_MS / 2);
    const submitted = await submitScoringBatch(supabase, await resolveTenantId());
    return NextResponse.json({ collected, submitted });
  } catch (e) {
    return errorResponse(e);
  }
}
