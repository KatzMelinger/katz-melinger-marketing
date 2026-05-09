/**
 * POST /api/recommendations/generate
 *
 * Asks Claude to read the firm's most recent SEO + AEO + cannibalization data
 * and produce a prioritized action list. Single round-trip — fast enough to
 * run on demand from the dashboard.
 */

import { NextResponse } from "next/server";
import { generateRecommendations } from "@/lib/ai-recommendations";
import { getSupabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await generateRecommendations();

    // Persist to history so the user can revisit past sets.
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

    return NextResponse.json({ ...result, history_id: historyId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "generate failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
