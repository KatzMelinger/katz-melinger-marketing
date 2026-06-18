/**
 * GET /api/seo/opportunities
 *
 * Reads the persistent seo_opportunities table (populated by
 * /api/seo/opportunities/sync). By default returns only actionable rows:
 * not excluded (passed the relevance filter) and status "new". Reveal more via
 * query flags:
 *
 *   ?include=excluded   also return filtered-out junk (with reasons)
 *   ?include=handled    also return rows already acted on (brief/in_production/
 *                       published/dismissed)
 *
 * The table is small (capped at a couple hundred rows), so we fetch and filter
 * in app code rather than build dynamic queries.
 */

import { NextRequest, NextResponse } from "next/server";

import { loadCoverageMap, semanticKey, type CoverageMatch } from "@/lib/content-dedup";
import { getTenantDb } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: string;
  keyword: string;
  source: string;
  list_name: string | null;
  competitor: string | null;
  search_volume: number | null;
  keyword_difficulty: number | null;
  our_position: number | null;
  competitor_position: number | null;
  intent: string | null;
  practice_area: string | null;
  pillar_id: string | null;
  recommended_content_type: string | null;
  relevance_score: number;
  excluded: boolean;
  exclude_reason: string | null;
  flags: unknown;
  existing_url: string | null;
  status: string;
  brief_id: string | null;
  draft_id: string | null;
  metrics: unknown;
  cluster_id: string | null;
  cluster_role: string | null;
  cluster_type: string | null;
  cluster_primary_keyword: string | null;
  last_synced_at: string | null;
  created_at: string;
};

const HANDLED = new Set(["brief", "in_production", "published", "dismissed"]);

export async function GET(req: NextRequest) {
  try {
    const include = (req.nextUrl.searchParams.get("include") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const showExcluded = include.includes("excluded");
    const showHandled = include.includes("handled");
    const showCovered = include.includes("covered");

    // Authenticated, RLS-scoped: returns only the caller's tenant rows.
    const db = await getTenantDb();
    const { data, error } = await db
      .from("seo_opportunities")
      .select("*")
      .order("relevance_score", { ascending: false })
      .order("search_volume", { ascending: false, nullsFirst: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const all = (data ?? []) as Row[];

    // Registry coverage: a keyword that already has a draft / brief / board item /
    // published page elsewhere (Content Studio, Peggy, the agent) is "already
    // covered" even if its own opp.existing_url is empty. Loaded once and matched
    // on the semantic key so word-order / abbreviation variants line up. Fail-soft:
    // a registry hiccup must never hide real opportunities.
    let coverageMap = new Map<string, CoverageMatch>();
    try {
      coverageMap = await loadCoverageMap(db.tenantId);
    } catch {
      /* fail soft — no registry annotation this load */
    }
    // The registry match for a row, excluding rows that already surface their own
    // existing_url badge (so we don't double-badge the same coverage).
    const registryCover = (r: Row): CoverageMatch | null =>
      r.existing_url ? null : coverageMap.get(semanticKey(r.keyword)) ?? null;
    const isCovered = (r: Row): boolean => !!r.existing_url || !!registryCover(r);

    const counts = {
      total: all.length,
      actionable: all.filter((r) => !r.excluded && r.status === "new" && !isCovered(r)).length,
      excluded: all.filter((r) => r.excluded).length,
      covered: all.filter((r) => isCovered(r) && !r.excluded).length,
      handled: all.filter((r) => HANDLED.has(r.status)).length,
    };

    const visible = all.filter((r) => {
      if (r.excluded && !showExcluded) return false;
      if (HANDLED.has(r.status) && !showHandled) return false;
      // "Already covered" keywords (own URL or a registry match) are refresh
      // candidates, not new opportunities — hidden unless explicitly revealed.
      if (isCovered(r) && !showCovered) return false;
      return true;
    });

    const lastSyncedAt =
      all.map((r) => r.last_synced_at).filter(Boolean).sort().at(-1) ?? null;

    return NextResponse.json({
      opportunities: visible.map((r) => {
        const cov = registryCover(r);
        return {
        id: r.id,
        keyword: r.keyword,
        source: r.source,
        listName: r.list_name,
        competitor: r.competitor,
        searchVolume: r.search_volume,
        keywordDifficulty: r.keyword_difficulty,
        ourPosition: r.our_position,
        competitorPosition: r.competitor_position,
        intent: r.intent,
        practiceArea: r.practice_area,
        pillarId: r.pillar_id,
        recommendedContentType: r.recommended_content_type,
        relevanceScore: r.relevance_score,
        excluded: r.excluded,
        excludeReason: r.exclude_reason,
        flags: Array.isArray(r.flags) ? r.flags : [],
        existingUrl: r.existing_url,
        status: r.status,
        briefId: r.brief_id,
        draftId: r.draft_id,
        metrics: r.metrics ?? {},
        clusterId: r.cluster_id,
        clusterRole: r.cluster_role,
        clusterType: r.cluster_type,
        clusterPrimaryKeyword: r.cluster_primary_keyword,
        // Registry coverage for the row badge ("Draft exists" / "Published").
        coverage: cov
          ? {
              badge: cov.badge,
              label: cov.label,
              status: cov.status ?? null,
              href: cov.url ?? (cov.kind === "published" ? cov.id : "/content-production"),
            }
          : null,
        };
      }),
      counts,
      lastSyncedAt,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load opportunities" },
      { status: 500 },
    );
  }
}
