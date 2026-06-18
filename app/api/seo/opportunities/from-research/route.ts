/**
 * POST /api/seo/opportunities/from-research
 *
 * "Send to Opportunities" — promotes a keyword the user discovered manually in
 * Keyword Research (Discover / Expand / Competitor Gaps) into the SEO Opportunity
 * Radar so it can follow the same flow as everything else (Create Brief →
 * Production Board → Draft → Approve → Published).
 *
 * The keyword lands with `source: "manual"` so the Radar can show it came from
 * hands-on research rather than the DataForSEO sync. It runs the SAME relevance
 * filter + classifier the sync uses, so a manual row is shaped identically to a
 * synced one (intent, practice area, pillar, recommended content type).
 *
 * Idempotent + non-destructive: if the keyword is already an opportunity, we
 * never downgrade a status the user has acted on — we just report it's already
 * there. A brand-new keyword inserts as `status: "new"`.
 */

import { NextRequest, NextResponse } from "next/server";

import type { KMContentType, KMSearchIntent } from "@/lib/km-content-system";
import {
  competitorTokensFromDomains,
  KM_BRAND_TOKENS,
  scoreKeyword,
} from "@/lib/keyword-filter";
import { listCompetitors } from "@/lib/seo-competitors";
import { listExclusionTerms } from "@/lib/keyword-exclusions";
import { inferIntentWithConfidence, inferPillar, inferPracticeArea } from "@/lib/strategy-engine";
import { getPillars } from "@/lib/pillars-store";
import { scoreOpportunity } from "@/lib/opportunity-scoring";
import { resolveTenantId } from "@/lib/tenant-context";
import { getTenantJobDb } from "@/lib/tenant-db";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Intent → KM content type (Practice Page / Blog / Case Result). */
function contentTypeFromIntent(intent: KMSearchIntent): KMContentType {
  if (intent === "commercial") return "practice_page";
  if (intent === "proof") return "case_result";
  return "blog_post";
}

/** Single-keyword priority bucket (the sync does this by batch percentile). */
function priorityFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

const normalize = (k: string) => k.trim().toLowerCase();

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;

  let body: { keyword?: unknown; searchVolume?: unknown; competitor?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const keyword = typeof body.keyword === "string" ? normalize(body.keyword) : "";
  if (!keyword) {
    return NextResponse.json({ error: "keyword is required" }, { status: 400 });
  }
  const searchVolume =
    typeof body.searchVolume === "number" && Number.isFinite(body.searchVolume)
      ? body.searchVolume
      : null;
  const competitor = typeof body.competitor === "string" ? body.competitor : null;

  const tenantId = await resolveTenantId();
  const db = getTenantJobDb(tenantId);

  // Don't resurrect or downgrade a keyword the user has already acted on.
  const { data: existingRows } = await db
    .select("seo_opportunities", "keyword, status, source")
    .eq("keyword", keyword);
  const existing = ((existingRows ?? []) as unknown as Array<{
    keyword: string;
    status: string;
    source: string;
  }>)[0];
  if (existing) {
    return NextResponse.json({
      added: false,
      alreadyExists: true,
      status: existing.status,
      source: existing.source,
      message: `"${keyword}" is already in Opportunities (status: ${existing.status}).`,
    });
  }

  // Same classification path the sync uses, so a manual row is shaped like a
  // synced one. Rules-only — no extra API/LLM cost.
  const competitors = await listCompetitors(tenantId);
  const [customExclusions, pillars] = await Promise.all([
    listExclusionTerms(tenantId).catch(() => [] as string[]),
    getPillars(tenantId).catch(() => []),
  ]);
  const ctx = {
    brandTokens: KM_BRAND_TOKENS,
    competitorTokens: competitorTokensFromDomains(competitors),
    customExclusions,
  };

  const quality = scoreKeyword(keyword, { searchVolume }, ctx);

  const clusterInput = {
    clusterName: keyword,
    primaryKeyword: keyword,
    volume: searchVolume,
    currentRank: null,
  };
  const practiceArea = inferPracticeArea(clusterInput);
  const { intent, labeledByDefault } = inferIntentWithConfidence(clusterInput);
  const pillarId = inferPillar(clusterInput, practiceArea, pillars);

  // Manual keywords are brand-new pages by definition → "create".
  const opportunityScore = scoreOpportunity({
    searchVolume,
    ourPosition: null,
    competitorPosition: null,
    competitorsBeatingUs: null,
    actionLabel: "create",
  });

  const now = new Date().toISOString();
  const row = {
    keyword,
    source: "manual",
    competitor,
    search_volume: searchVolume,
    our_position: null,
    competitor_position: null,
    relevance_score: quality.relevanceScore,
    excluded: quality.excluded,
    exclude_reason: quality.excludeReason ?? null,
    flags: quality.flags,
    intent,
    labeled_by_default: labeledByDefault,
    practice_area: practiceArea,
    pillar_id: pillarId,
    recommended_content_type: contentTypeFromIntent(intent),
    existing_url: null,
    action_label: "create",
    opportunity_score: opportunityScore,
    priority_label: priorityFromScore(opportunityScore),
    status: "new",
    metrics: { searchVolume, source: "manual" },
    last_synced_at: now,
    updated_at: now,
  };

  const { error } = await db.insert("seo_opportunities", row);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    added: true,
    keyword,
    intent,
    practiceArea,
    recommendedContentType: row.recommended_content_type,
    excluded: quality.excluded,
    message: `Added "${keyword}" to Opportunities.`,
  });
}
