/**
 * POST /api/seo/tracked-keywords/refresh
 *   (UI trigger — Refresh button on /keyword-research and the
 *   `refresh_tracked_keywords` agent tool)
 *
 * GET /api/seo/tracked-keywords/refresh
 *   (Vercel Cron trigger — requires Authorization: Bearer ${CRON_SECRET})
 *
 * Refreshes ranking data for all tracked keywords by hitting Semrush once
 * for the firm's domain and matching tracked keywords against the result.
 * Preserves the previous rank in `previous_rank` so the UI can show movement.
 *
 * Replaces the SE Ranking version from
 *   artifacts/api-server/src/routes/keywords.ts (Replit).
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantConfig } from "@/lib/tenant-config";
import { resolveTenantId } from "@/lib/tenant-context";
import { getTenantJobDb, listTenantIds } from "@/lib/tenant-db";
import { detectCannibalization } from "@/lib/cannibalization";
import { listCompetitors, normalizeDomain } from "@/lib/seo-competitors";
import { writeRankSnapshots } from "@/lib/rank-history";
import {
  getAIOverviewForKeyword,
  getDomainKeywords,
  getKeywordDifficulty,
  getLiveRank,
  getPhraseMetrics,
  type DataForSeoKeywordRow,
} from "@/lib/dataforseo";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Vercel Cron auth — Vercel injects `Authorization: Bearer ${CRON_SECRET}` on
 * scheduled invocations when CRON_SECRET is set as an env var. Reject anything
 * else so the cron URL can't be abused as a public refresh button.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Cron has no logged-in user — refresh every active firm explicitly.
  const tenantIds = await listTenantIds();
  const results = [];
  for (const tenantId of tenantIds) {
    results.push({ tenantId, ...(await refreshTrackedKeywords(tenantId)) });
  }
  return NextResponse.json({ tenants: results.length, results });
}

export async function POST() {
  // UI "Refresh" button — refresh just the caller's firm.
  const tenantId = await resolveTenantId();
  return NextResponse.json(await refreshTrackedKeywords(tenantId));
}

async function refreshTrackedKeywords(tenantId: string) {
  try {
    const db = getTenantJobDb(tenantId);
    const { semrushDomain } = await getTenantConfig(tenantId);

    const { data: rawItems, error: loadErr } = await db
      .select("seo_keywords")
      .order("created_at", { ascending: true });

    if (loadErr) {
      console.error("[seo/keywords/refresh] load error:", loadErr.message);
      return { error: "Failed to load tracked keywords" };
    }

    const items = (rawItems ?? []) as unknown as Array<{
      id: string;
      keyword: string;
      current_rank: number | null;
      search_volume: number | null;
      difficulty: number | null;
    }>;
    if (items.length === 0) {
      return { updated: 0, keywords: [] };
    }

    // Pull the firm's full ranked-keywords snapshot once (DataForSEO Labs).
    // 1000 rows covers the keywords likely to rank for matching purposes;
    // keywords missing from the snapshot get a live-SERP rank fallback below.
    let rankedRows: DataForSeoKeywordRow[];
    try {
      rankedRows = await getDomainKeywords(semrushDomain, undefined, 1000, 0, "traffic", "desc");
    } catch (err) {
      console.error(
        "[seo/keywords/refresh] DataForSEO failed:",
        err instanceof Error ? err.message : String(err),
      );
      return { error: "Could not reach DataForSEO API" };
    }

    // For each tracked keyword try to match it against the firm's organic
    // report. If we have no match we still want volume + difficulty in the UI
    // — pull those via phrase_these / phrase_kdi for the unmatched set.
    const matchByKeyword = new Map<string, DataForSeoKeywordRow | null>();
    const unmatchedPhrases: string[] = [];
    const phrasesNeedingKd: string[] = [];

    for (const item of items) {
      const target = item.keyword.toLowerCase().trim();
      const exact = rankedRows.find(
        (r) => r.keyword.toLowerCase().trim() === target,
      );
      const partial =
        exact ??
        rankedRows.find(
          (r) =>
            r.keyword.toLowerCase().includes(target) ||
            target.includes(r.keyword.toLowerCase()),
        ) ??
        null;
      matchByKeyword.set(item.id, partial);

      if (partial && partial.difficulty === null) {
        phrasesNeedingKd.push(partial.keyword);
      }
      if (!partial) {
        unmatchedPhrases.push(item.keyword);
        phrasesNeedingKd.push(item.keyword);
      }
    }

    const [kdMap, metricsMap] = await Promise.all([
      phrasesNeedingKd.length > 0
        ? getKeywordDifficulty(phrasesNeedingKd).catch(
            () => new Map<string, number>(),
          )
        : Promise.resolve(new Map<string, number>()),
      unmatchedPhrases.length > 0
        ? getPhraseMetrics(unmatchedPhrases).catch(
            () =>
              new Map<string, { volume: number; cpc: number; competition: number }>(),
          )
        : Promise.resolve(
            new Map<string, { volume: number; cpc: number; competition: number }>(),
          ),
    ]);

    // Live-SERP rank fallback. DataForSEO's Labs snapshot can lag live SERPs
    // and omit keywords the firm actually ranks for (verified in the migration
    // parity check). For tracked keywords missing from the snapshot, do a
    // bounded set of real-time SERP lookups so the rank column is accurate —
    // this makes us MORE accurate than the old Semrush snapshot-only refresh.
    const LIVE_RANK_CAP = 50;
    const liveRankMap = new Map<string, number | null>();
    const toLookup = unmatchedPhrases.slice(0, LIVE_RANK_CAP);
    if (unmatchedPhrases.length > LIVE_RANK_CAP) {
      console.warn(
        `[seo/keywords/refresh] ${unmatchedPhrases.length} keywords missing from snapshot; ` +
          `live-SERP rank fallback capped at ${LIVE_RANK_CAP} this run.`,
      );
    }
    await Promise.all(
      toLookup.map(async (kw) => {
        const rank = await getLiveRank(kw, semrushDomain).catch(() => null);
        liveRankMap.set(kw.toLowerCase().trim(), rank);
      }),
    );

    // AI Overview check (C) — does this keyword trigger a Google AI Overview,
    // and is our domain cited in it? Each is a live SERP-advanced call, so this
    // is bounded like the live-rank fallback. Non-fatal + best-effort.
    const AI_OVERVIEW_CAP = 50;
    const aiOverviewMap = new Map<
      string,
      { present: boolean; cited: boolean; sources: string[] }
    >();
    const aoTargets = items.slice(0, AI_OVERVIEW_CAP);
    if (items.length > AI_OVERVIEW_CAP) {
      console.warn(
        `[seo/keywords/refresh] AI-Overview check capped at ${AI_OVERVIEW_CAP} of ${items.length} keywords this run.`,
      );
    }
    await Promise.all(
      aoTargets.map(async (it) => {
        const ao = await getAIOverviewForKeyword(it.keyword, semrushDomain).catch(
          () => null,
        );
        if (ao) aiOverviewMap.set(it.id, ao);
      }),
    );

    // Apply updates row by row. Could be batched with .upsert, but per-row
    // gives us cleaner error handling and the volume here is small (typically
    // <100 tracked keywords).
    let updated = 0;
    const now = new Date().toISOString();
    // Today's date (UTC) — daily granularity key for the rank-history snapshot.
    const capturedOn = now.slice(0, 10);
    // Per-keyword final rank for OUR domain, fed into the history snapshot below.
    const ourSnapshot: Array<{ keyword: string; rank: number | null; url: string | null }> = [];
    for (const item of items) {
      const match = matchByKeyword.get(item.id);
      const target = item.keyword.toLowerCase().trim();

      let newRank: number | null;
      let searchVolume: number | null;
      let difficulty: number | null;
      let url: string | null;

      if (match) {
        newRank = match.position;
        searchVolume = match.volume;
        difficulty =
          match.difficulty ??
          kdMap.get(match.keyword.toLowerCase().trim()) ??
          item.difficulty ??
          null;
        url = match.url;
      } else {
        // Not in the snapshot — use the live-SERP rank if we found one, and
        // surface volume/difficulty from phrase-level data.
        const metrics = metricsMap.get(target);
        newRank = liveRankMap.get(target) ?? null;
        searchVolume = metrics ? metrics.volume : item.search_volume ?? null;
        difficulty = kdMap.get(target) ?? item.difficulty ?? null;
        url = null;
      }

      ourSnapshot.push({ keyword: item.keyword, rank: newRank, url });

      // AI Overview columns only for keywords we checked this run (conditional
      // spread so capped keywords keep their prior values rather than reset).
      const ao = aiOverviewMap.get(item.id);

      const { error: updateErr } = await db.raw
        .from("seo_keywords")
        .update({
          previous_rank: item.current_rank,
          current_rank: newRank,
          search_volume: searchVolume,
          difficulty,
          url,
          last_checked_at: now,
          ...(ao
            ? {
                ai_overview_present: ao.present,
                ai_overview_cited: ao.cited,
                ai_overview_sources: ao.sources,
                ai_overview_checked_at: now,
              }
            : {}),
        })
        .eq("id", item.id)
        .eq("tenant_id", tenantId);

      if (updateErr) {
        console.error(
          "[seo/keywords/refresh] update error for",
          item.keyword,
          updateErr.message,
        );
        continue;
      }
      updated++;
    }

    const { data: refreshed } = await db
      .select("seo_keywords")
      .order("created_at", { ascending: true });

    // Keep the cannibalization snapshot fresh on the same schedule as rankings,
    // reusing the ranked-keyword rows we already pulled above — no extra API
    // spend. Non-fatal: a failure here must not fail the ranking refresh.
    let cannibalizationIssues: number | null = null;
    try {
      const { issues } = await detectCannibalization(semrushDomain, rankedRows, tenantId);
      cannibalizationIssues = issues.length;
    } catch (err) {
      console.error(
        "[seo/keywords/refresh] cannibalization scan failed:",
        err instanceof Error ? err.message : String(err),
      );
    }

    // Append today's rank snapshot for the firm domain AND every tracked
    // competitor, building the position-history time-series (Semrush-style
    // trend chart + date-over-date columns). Non-fatal: a failure here must
    // not fail the ranking refresh. Competitor ranks reuse their cached
    // ranked-keywords snapshot (no live-SERP spend) — exact/partial match per
    // tracked keyword, null when the competitor isn't in the top 100.
    let snapshotRows: number | null = null;
    try {
      const competitors = await listCompetitors(tenantId);
      const trackedKeywords = items.map((it) => it.keyword);
      snapshotRows = await writeRankSnapshots({
        db,
        tenantId,
        capturedOn,
        ownDomain: normalizeDomain(semrushDomain),
        ownSnapshot: ourSnapshot,
        competitors,
        trackedKeywords,
      });
    } catch (err) {
      console.error(
        "[seo/keywords/refresh] rank-history snapshot failed:",
        err instanceof Error ? err.message : String(err),
      );
    }

    return {
      updated,
      keywords: refreshed ?? [],
      cannibalizationIssues,
      snapshotRows,
    };
  } catch (err) {
    console.error(
      "[seo/keywords/refresh] Failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: "Failed to refresh keyword rankings" };
  }
}
