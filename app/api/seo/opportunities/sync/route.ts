/**
 * POST /api/seo/opportunities/sync
 *
 * Refreshes the seo_opportunities table from SEMrush: pulls competitor gaps +
 * missing targets + long-tail suggestions, runs the relevance filter
 * (lib/keyword-filter), and UPSERTS each keyword (idempotent on `keyword`).
 *
 * Re-syncing never resurrects or downgrades a row the user has acted on — an
 * existing `dismissed` / `brief` / `in_production` / `published` status is
 * preserved; only the metric + relevance fields refresh. New keywords land as
 * `status: "new"`.
 *
 * Classification (intent/practice area/content type) and dedupe are added in
 * Phase B; this Phase-A version handles filtering + the persistent spine.
 */

import { NextResponse } from "next/server";

import { detectContentOverlap } from "@/lib/content-overlap";
import type { KMContentType, KMSearchIntent } from "@/lib/km-content-system";
import {
  competitorTokensFromDomains,
  KM_BRAND_TOKENS,
  scoreKeyword,
} from "@/lib/keyword-filter";
import { listCompetitors } from "@/lib/seo-competitors";
import {
  getKeywordGapVsCompetitors,
  getTrackedKeywordPerformance,
} from "@/lib/seo-intelligence";
import { SEMRUSH_DOMAIN } from "@/lib/semrush";
import { inferIntent, inferPillar, inferPracticeArea } from "@/lib/strategy-engine";
import { getSupabaseAdmin } from "@/lib/supabase-server";

/** Intent → KM content type (Practice Page / Blog / Case Result). */
function contentTypeFromIntent(intent: KMSearchIntent): KMContentType {
  if (intent === "commercial") return "practice_page";
  if (intent === "proof") return "case_result";
  return "blog_post";
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_KEYWORDS = 200;
// Statuses the user has acted on — a re-sync must not overwrite these.
const LOCKED_STATUSES = new Set(["dismissed", "brief", "in_production", "published"]);

type Candidate = {
  keyword: string;
  source: "quickwin" | "missing" | "longtail";
  searchVolume: number | null;
  ourPosition: number | null;
  competitorPosition: number | null;
  opportunityScore: number | null;
  competitor: string | null;
};

const normalize = (k: string) => k.trim().toLowerCase();

export async function POST() {
  try {
    const competitors = await listCompetitors();
    const ctx = {
      brandTokens: KM_BRAND_TOKENS,
      competitorTokens: competitorTokensFromDomains(competitors),
    };

    const [gaps, tracked] = await Promise.all([
      getKeywordGapVsCompetitors(competitors, SEMRUSH_DOMAIN, 120).catch(() => []),
      getTrackedKeywordPerformance(SEMRUSH_DOMAIN).catch(() => ({
        missingTargets: [] as string[],
        longTailSuggestions: [] as Array<{ keyword: string; searchVolume: number }>,
      })),
    ]);

    // Merge candidates, dedupe by normalized keyword (quickwin > missing > longtail).
    const byKeyword = new Map<string, Candidate>();
    for (const g of gaps) {
      const key = normalize(g.keyword);
      if (!byKeyword.has(key)) {
        byKeyword.set(key, {
          keyword: key,
          source: "quickwin",
          searchVolume: g.searchVolume ?? null,
          ourPosition: g.ourPosition ?? null,
          competitorPosition: g.competitorPosition ?? null,
          opportunityScore: g.opportunityScore ?? null,
          competitor: g.domain ?? null,
        });
      }
    }
    for (const kw of tracked.missingTargets ?? []) {
      const key = normalize(kw);
      if (!byKeyword.has(key)) {
        byKeyword.set(key, {
          keyword: key,
          source: "missing",
          searchVolume: null,
          ourPosition: null,
          competitorPosition: null,
          opportunityScore: null,
          competitor: null,
        });
      }
    }
    for (const lt of tracked.longTailSuggestions ?? []) {
      const key = normalize(lt.keyword);
      if (!byKeyword.has(key)) {
        byKeyword.set(key, {
          keyword: key,
          source: "longtail",
          searchVolume: lt.searchVolume ?? null,
          ourPosition: null,
          competitorPosition: null,
          opportunityScore: null,
          competitor: null,
        });
      }
    }

    const candidates = Array.from(byKeyword.values()).slice(0, MAX_KEYWORDS);
    if (candidates.length === 0) {
      return NextResponse.json({ synced: 0, message: "No candidates returned from SEMrush." });
    }

    const supabase = getSupabaseAdmin();

    // Preserve user-acted statuses: fetch existing rows for these keywords.
    const keys = candidates.map((c) => c.keyword);
    const { data: existingRows } = await supabase
      .from("seo_opportunities")
      .select("keyword, status")
      .in("keyword", keys);
    const existingStatus = new Map(
      (existingRows ?? []).map((r) => [r.keyword as string, r.status as string]),
    );

    // Dedupe against existing site pages in one query (Phase B). Map each
    // keyword to the top existing page that already covers it, if any.
    const overlap = await detectContentOverlap(keys).catch(() => null);
    const coveredByKeyword = new Map<string, string>();
    for (const m of overlap?.matches ?? []) {
      const top = m.pages[0];
      if (top) coveredByKeyword.set(m.term.trim().toLowerCase(), top.url);
    }

    const now = new Date().toISOString();
    const rows = candidates.map((c) => {
      const quality = scoreKeyword(
        c.keyword,
        { searchVolume: c.searchVolume },
        ctx,
      );
      const prior = existingStatus.get(c.keyword);
      const status = prior && LOCKED_STATUSES.has(prior) ? prior : "new";

      // Classification (Phase B) — rules-only, no LLM cost.
      const clusterInput = {
        clusterName: c.keyword,
        primaryKeyword: c.keyword,
        volume: c.searchVolume,
        currentRank: c.ourPosition,
      };
      const practiceArea = inferPracticeArea(clusterInput);
      const intent = inferIntent(clusterInput);
      const pillarId = inferPillar(clusterInput, practiceArea);

      return {
        keyword: c.keyword,
        source: c.source,
        competitor: c.competitor,
        search_volume: c.searchVolume,
        our_position: c.ourPosition,
        competitor_position: c.competitorPosition,
        relevance_score: quality.relevanceScore,
        excluded: quality.excluded,
        exclude_reason: quality.excludeReason ?? null,
        flags: quality.flags,
        intent,
        practice_area: practiceArea,
        pillar_id: pillarId,
        recommended_content_type: contentTypeFromIntent(intent),
        existing_url: coveredByKeyword.get(c.keyword) ?? null,
        status,
        metrics: {
          searchVolume: c.searchVolume,
          ourPosition: c.ourPosition,
          competitorPosition: c.competitorPosition,
          opportunityScore: c.opportunityScore,
          competitor: c.competitor,
        },
        last_synced_at: now,
        updated_at: now,
      };
    });

    const { error } = await supabase
      .from("seo_opportunities")
      .upsert(rows, { onConflict: "keyword" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const excluded = rows.filter((r) => r.excluded).length;
    return NextResponse.json({
      synced: rows.length,
      excluded,
      kept: rows.length - excluded,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 },
    );
  }
}
