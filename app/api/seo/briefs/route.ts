/**
 * POST /api/seo/briefs
 *
 * Persists a brief built in the SEO brief wizard into the existing
 * brief_suggestions table (reused as the brief store) and returns its id. The
 * wizard then links it to the originating opportunity and hands it to
 * /api/content/km-draft for generation.
 *
 * Body: { brief: KMPerPageBrief, language?: "en"|"es" }
 */

import { NextRequest, NextResponse } from "next/server";

import { normalizeLanguage } from "@/lib/content-language";
import type { KMPerPageBrief } from "@/lib/km-content-system";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const brief = body?.brief as Partial<KMPerPageBrief> | undefined;
    if (!brief || !brief.primaryKeyword || !brief.contentType || !brief.practiceArea) {
      return NextResponse.json(
        { error: "brief with primaryKeyword, contentType and practiceArea is required" },
        { status: 400 },
      );
    }
    const language = normalizeLanguage(body?.language);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("brief_suggestions")
      .insert({
        cluster_name: brief.primaryKeyword,
        primary_keyword: brief.primaryKeyword,
        secondary_keywords: brief.secondaryKeywords ?? [],
        content_type: brief.contentType,
        practice_area: brief.practiceArea,
        pillar_id: brief.pillarId ?? null,
        search_intent: brief.searchIntent ?? null,
        recommended_action: "new_page",
        priority: "medium",
        reasoning: "Built in the SEO brief wizard from a tracked opportunity.",
        decision_source: "hybrid",
        suggested_brief: brief,
        metrics: { language },
        status: "approved",
        source: "opportunity_radar",
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ id: data?.id ?? null });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save brief" },
      { status: 500 },
    );
  }
}
