/**
 * POST /api/seo/opportunities/sync
 *   (UI trigger — "Refresh opportunities" button on /seo/opportunities)
 *
 * GET /api/seo/opportunities/sync
 *   (Vercel Cron trigger — requires Authorization: Bearer ${CRON_SECRET})
 *
 * Refreshes the seo_opportunities table from SEMrush: pulls competitor gaps +
 * missing targets + long-tail suggestions, runs the relevance filter
 * (lib/keyword-filter), and UPSERTS each keyword (idempotent on `keyword`).
 *
 * Re-syncing never resurrects or downgrades a row the user has acted on — an
 * existing `dismissed` / `brief` / `in_production` / `published` status is
 * preserved; only the metric + relevance fields refresh. New keywords land as
 * `status: "new"`. Imported list keywords (`source: "imported"`) keep their
 * `list_name` because upsert only touches the columns in the sync payload.
 */

import { NextRequest, NextResponse } from "next/server";

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
import { inferIntentWithConfidence, inferPillar, inferPracticeArea } from "@/lib/strategy-engine";
import { getPillars } from "@/lib/pillars-store";
import { deriveActionLabel } from "@/lib/action-label";
import { assignPriorityLabels, scoreOpportunity } from "@/lib/opportunity-scoring";
import { fetchWordPressModifiedMap, normalizeUrlForMatch } from "@/lib/wordpress";
import { fetchGscPositionMap } from "@/lib/gsc-positions";
import { getTenantConfig } from "@/lib/tenant-config";
import { resolveTenantId } from "@/lib/tenant-context";
import { getTenantJobDb, listTenantIds } from "@/lib/tenant-db";

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
  competitorsBeatingUs: number | null;
};

const normalize = (k: string) => k.trim().toLowerCase();

/**
 * Append a pipeline run record. Logging must never break or mask the pipeline
 * result, so all failures here are swallowed.
 */
async function logPipeline(
  db: ReturnType<typeof getTenantJobDb>,
  step: string,
  status: "success" | "failed",
  error: string | null,
  counts: Record<string, number>,
  startedAt: number,
): Promise<void> {
  try {
    await db.insert("pipeline_logs", {
      step_reached: step,
      status,
      error_message: error,
      counts,
      duration_ms: Date.now() - startedAt,
    });
  } catch {
    /* swallow */
  }
}

/**
 * Vercel Cron auth — Vercel injects `Authorization: Bearer ${CRON_SECRET}` on
 * scheduled invocations when CRON_SECRET is set. Reject anything else so the
 * cron URL can't be abused as a public, SEMrush-spending refresh button.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The cron has no logged-in user, so it can't infer a tenant — it must
  // process every active firm explicitly, each with its own config.
  const tenantIds = await listTenantIds();
  const results = [];
  for (const tenantId of tenantIds) {
    results.push({ tenantId, ...(await runSyncForTenant(tenantId)) });
  }
  return NextResponse.json({ tenants: results.length, results });
}

export async function POST() {
  // UI "Refresh" button — sync only the caller's firm.
  const tenantId = await resolveTenantId();
  return NextResponse.json(await runSyncForTenant(tenantId));
}

async function runSyncForTenant(tenantId: string) {
  const startedAt = Date.now();
  const db = getTenantJobDb(tenantId);
  const counts: Record<string, number> = {};
  // Tracks how far the pipeline got, so a failure log says where it stopped.
  let step = "source";
  try {
    // Firm-specific config (Semrush domain etc.) instead of a hardcoded constant.
    const { semrushDomain, gscSiteUrl } = await getTenantConfig(tenantId);
    const competitors = await listCompetitors(tenantId);
    const ctx = {
      brandTokens: KM_BRAND_TOKENS,
      competitorTokens: competitorTokensFromDomains(competitors),
    };
    // Live, DB-driven pillar list so the grouper routes to current pillars.
    const pillars = await getPillars(tenantId);

    const [gaps, tracked] = await Promise.all([
      getKeywordGapVsCompetitors(competitors, semrushDomain, 120).catch(() => []),
      getTrackedKeywordPerformance(semrushDomain, tenantId).catch(() => ({
        missingTargets: [] as string[],
        longTailSuggestions: [] as Array<{ keyword: string; searchVolume: number }>,
      })),
    ]);
    counts.gaps = gaps.length;

    // Merge candidates, dedupe by normalized keyword (quickwin > missing > longtail).
    step = "classify";
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
          competitorsBeatingUs: g.competitorsBeatingUs ?? null,
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
          competitorsBeatingUs: null,
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
          competitorsBeatingUs: null,
        });
      }
    }

    const candidates = Array.from(byKeyword.values()).slice(0, MAX_KEYWORDS);
    counts.candidates = candidates.length;
    if (candidates.length === 0) {
      await logPipeline(db, "done", "success", null, counts, startedAt);
      return { synced: 0, message: "No candidates returned from SEMrush." };
    }

    // Preserve user-acted statuses: fetch this tenant's existing rows.
    const keys = candidates.map((c) => c.keyword);
    const { data: existingRows } = await db
      .select("seo_opportunities", "keyword, status")
      .in("keyword", keys);
    const existingStatus = new Map(
      ((existingRows ?? []) as unknown as Array<{ keyword: string; status: string }>).map(
        (r) => [r.keyword, r.status],
      ),
    );

    // Dedupe against existing site pages in one query (Phase B). Map each
    // keyword to the top existing page that already covers it, if any.
    const overlap = await detectContentOverlap(keys).catch(() => null);
    const coveredByKeyword = new Map<string, string>();
    for (const m of overlap?.matches ?? []) {
      const top = m.pages[0];
      if (top) coveredByKeyword.set(m.term.trim().toLowerCase(), top.url);
    }

    // Step 3 inputs: live content-age (WordPress REST) + real positions (GSC).
    // Both are best-effort — a site without /wp-json or an unconnected GSC just
    // yields an empty map, and labels fall back to the SEMrush rank.
    step = "cannibalize";
    const [wpModified, gscPositions] = await Promise.all([
      fetchWordPressModifiedMap(semrushDomain).catch(() => new Map<string, string>()),
      fetchGscPositionMap(tenantId, gscSiteUrl).catch(() => new Map<string, number>()),
    ]);
    counts.gsc_positions = gscPositions.size;

    // Build + classify + score every row (Steps 1, 3 & 5).
    step = "score";
    const now = new Date().toISOString();
    const built = candidates.map((c) => {
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
      const { intent, labeledByDefault } = inferIntentWithConfidence(clusterInput);
      const pillarId = inferPillar(clusterInput, practiceArea, pillars);

      // Step 3 (cannibalization): Create / Optimize / Update. Prefers the real
      // GSC position + WordPress content-age (matched by normalized URL);
      // deriveActionLabel falls back to the SEMrush rank when either is absent.
      const existingUrl = coveredByKeyword.get(c.keyword) ?? null;
      const normUrl = existingUrl ? normalizeUrlForMatch(existingUrl) : null;
      const gscPosition = normUrl ? gscPositions.get(normUrl) ?? null : null;
      const existingUrlModifiedAt = normUrl ? wpModified.get(normUrl) ?? null : null;
      const actionLabel = deriveActionLabel({
        existingUrl,
        ourPosition: c.ourPosition,
        gscPosition,
        existingUrlModifiedAt,
      });

      const opportunityScore = scoreOpportunity({
        searchVolume: c.searchVolume,
        ourPosition: c.ourPosition,
        competitorPosition: c.competitorPosition,
        competitorsBeatingUs: c.competitorsBeatingUs,
        actionLabel,
      });

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
        labeled_by_default: labeledByDefault,
        practice_area: practiceArea,
        pillar_id: pillarId,
        recommended_content_type: contentTypeFromIntent(intent),
        existing_url: existingUrl,
        existing_url_position: gscPosition,
        existing_url_modified_at: existingUrlModifiedAt,
        action_label: actionLabel,
        opportunity_score: opportunityScore,
        status,
        metrics: {
          searchVolume: c.searchVolume,
          ourPosition: c.ourPosition,
          competitorPosition: c.competitorPosition,
          opportunityScore: c.opportunityScore,
          competitorsBeatingUs: c.competitorsBeatingUs,
          competitor: c.competitor,
        },
        last_synced_at: now,
        updated_at: now,
      };
    });

    // Priority bucket (high/medium/low) by percentile across this batch.
    const labels = assignPriorityLabels(built.map((b) => b.opportunity_score));
    const rows = built.map((b, i) => ({ ...b, priority_label: labels[i] }));

    // upsert stamps tenant_id; conflict key is (tenant_id, keyword).
    step = "persist";
    const { error } = await db.upsert("seo_opportunities", rows, {
      onConflict: "tenant_id,keyword",
    });
    if (error) throw new Error(error.message);

    // Step 4: persist competitor gaps — one row per keyword × best competitor.
    // A gap is "confirmed" when the competitor ranks 1-20 and we don't rank or
    // rank 21+. Powers the deduplicated page-decision count and the confirmed-
    // gap scorecard without a live SEMrush call on read.
    step = "gaps";
    const gapRows = gaps
      .filter((g) => (g.domain ?? "").length > 0)
      .map((g) => {
        const cp = g.competitorPosition ?? 0;
        const op = g.ourPosition ?? 0;
        const confirmed = cp > 0 && cp <= 20 && (op <= 0 || op > 20);
        return {
          keyword: normalize(g.keyword),
          competitor_domain: g.domain as string,
          competitor_position: g.competitorPosition ?? null,
          our_position: g.ourPosition ?? null,
          search_volume: g.searchVolume ?? null,
          confirmed_gap: confirmed,
          updated_at: now,
        };
      });
    if (gapRows.length > 0) {
      const { error: gapError } = await db.upsert("competitor_gaps", gapRows, {
        onConflict: "tenant_id,keyword,competitor_domain",
      });
      if (gapError) throw new Error(gapError.message);
    }
    counts.competitor_gaps = gapRows.length;

    const excluded = rows.filter((r) => r.excluded).length;
    counts.synced = rows.length;
    counts.excluded = excluded;
    await logPipeline(db, "done", "success", null, counts, startedAt);
    return {
      synced: rows.length,
      excluded,
      kept: rows.length - excluded,
      competitorGaps: gapRows.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    await logPipeline(db, step, "failed", msg, counts, startedAt);
    return { error: msg };
  }
}
