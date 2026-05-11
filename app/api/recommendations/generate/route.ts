/**
 * POST /api/recommendations/generate
 *
 * Asks Claude to read the firm's most recent SEO + AEO + cannibalization data
 * and produce a prioritized action list. Single round-trip — fast enough to
 * run on demand from the dashboard.
 */

import { NextResponse } from "next/server";

import { generateRecommendations } from "@/lib/ai-recommendations";
import {
  listSuppressedTitles,
  persistGeneratedRecommendations,
} from "@/lib/recommendation-items";
import { getSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    // Skip anything the user has already marked done or disregarded so Claude
    // doesn't keep proposing work that's been completed or rejected.
    const suppressTitles = await listSuppressedTitles();
    const result = await generateRecommendations({ suppressTitles });

    // Persist the whole batch to history (for the batch-replay sidebar)…
    let historyId: string | null = null;
    const supabase = getSupabaseServer();
    if (supabase) {
      try {
        const { data } = await supabase
          .from("recommendations_history")
          .insert({
            recommendations: result.recommendations,
            evidence: result.evidence,
            rec_count: result.recommendations.length,
          })
          .select("id")
          .single();
        historyId = (data?.id as string | undefined) ?? null;
      } catch (err) {
        console.warn("[recommendations/generate] history persist failed:", err);
      }
    }

    // …and each recommendation as a tracked item with status='active' (skips
    // any title that already exists in any bucket).
    const { inserted, skipped } = await persistGeneratedRecommendations(
      result.recommendations,
      historyId,
    );

    return NextResponse.json({
      ...result,
      history_id: historyId,
      itemsInserted: inserted,
      itemsSkipped: skipped,
      suppressedCount: suppressTitles.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "generate failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
