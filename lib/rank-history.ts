/**
 * Rank-history time-series — the data behind the DataForSEO-style "Position
 * Tracking" view (visibility trend chart + date-over-date comparison columns).
 *
 * Two responsibilities:
 *   • writeRankSnapshots — called by the daily tracked-keyword refresh cron to
 *     append one row per (tracked keyword × domain × day) for the firm AND every
 *     tracked competitor. Persisted in seo_rank_snapshots.
 *   • shapeRankHistory — pure transform from raw snapshot rows into the chart +
 *     comparison-table shape the /api/seo/rank-history route serves.
 *
 * Visibility metric: the average organic CTR across all tracked keywords for a
 * domain on a given day, as a percentage. A domain that ranks #1 for every
 * keyword approaches ~32%; one that ranks nowhere sits at 0%. It moves with the
 * rankings, which is all the trend line needs — it is NOT DataForSEO's proprietary
 * visibility score, just a comparable CTR-weighted share.
 */

import { getDomainKeywords, type DataForSeoKeywordRow } from "@/lib/dataforseo";
import { normalizeDomain } from "@/lib/seo-competitors";
import type { getTenantJobDb } from "@/lib/tenant-db";

/** Raw seo_rank_snapshots row (the columns we read back for the UI). */
export type RankSnapshotRow = {
  keyword: string;
  domain: string;
  rank: number | null;
  captured_on: string; // YYYY-MM-DD
};

export type RankHistoryResponse = {
  ownDomain: string;
  /** All domains present, firm domain first, then competitors A→Z. */
  domains: string[];
  /** Distinct capture dates, ascending. */
  dates: string[];
  /** domain → date → visibility % (0–100). */
  visibility: Record<string, Record<string, number>>;
  /** Per-keyword ranks: keyword → domain → date → rank (null = unranked). */
  keywords: Array<{
    keyword: string;
    ranks: Record<string, Record<string, number | null>>;
  }>;
};

/**
 * Approximate organic click-through rate by SERP position. Standard
 * position-CTR curve, collapsed into bands past the top 10. Returns 0 for
 * unranked / beyond top 100.
 */
function ctrForRank(rank: number | null): number {
  if (rank === null || rank < 1 || rank > 100) return 0;
  const top10: Record<number, number> = {
    1: 0.317, 2: 0.247, 3: 0.187, 4: 0.13, 5: 0.095,
    6: 0.068, 7: 0.05, 8: 0.04, 9: 0.034, 10: 0.03,
  };
  if (rank <= 10) return top10[rank];
  if (rank <= 20) return 0.015;
  if (rank <= 50) return 0.008;
  return 0.003;
}

// Cap how many competitors we snapshot per run. Each is one cached
// ranked-keywords call; this bounds API spend if the tracked list grows large.
const MAX_COMPETITORS = 12;

/** Find a domain's rank for one keyword in its ranked-keywords snapshot. */
function rankInRows(
  keyword: string,
  rows: DataForSeoKeywordRow[],
): { rank: number | null; url: string | null } {
  const target = keyword.toLowerCase().trim();
  const exact = rows.find((r) => r.keyword.toLowerCase().trim() === target);
  const match =
    exact ??
    rows.find(
      (r) =>
        r.keyword.toLowerCase().includes(target) ||
        target.includes(r.keyword.toLowerCase()),
    );
  if (!match) return { rank: null, url: null };
  return { rank: match.position, url: match.url };
}

/**
 * Append today's rank snapshot for the firm domain and every tracked
 * competitor. Idempotent for the day via upsert on
 * (tenant_id, keyword, domain, captured_on). Returns the number of rows written.
 */
export async function writeRankSnapshots(params: {
  db: ReturnType<typeof getTenantJobDb>;
  tenantId: string;
  capturedOn: string;
  ownDomain: string;
  ownSnapshot: Array<{ keyword: string; rank: number | null; url: string | null }>;
  competitors: string[];
  trackedKeywords: string[];
}): Promise<number> {
  const { db, capturedOn, ownDomain, ownSnapshot, competitors, trackedKeywords } = params;

  const rows: Array<{
    keyword: string;
    domain: string;
    rank: number | null;
    url: string | null;
    captured_on: string;
  }> = ownSnapshot.map((s) => ({
    keyword: s.keyword,
    domain: ownDomain,
    rank: s.rank,
    url: s.url,
    captured_on: capturedOn,
  }));

  const competitorDomains = competitors
    .map((c) => normalizeDomain(c))
    .filter((d) => d && d !== ownDomain)
    .slice(0, MAX_COMPETITORS);

  for (const domain of competitorDomains) {
    let ranked: DataForSeoKeywordRow[];
    try {
      ranked = await getDomainKeywords(domain, undefined, 1000, 0, "traffic", "desc");
    } catch (err) {
      console.error(
        `[rank-history] competitor snapshot failed for ${domain}:`,
        err instanceof Error ? err.message : String(err),
      );
      continue; // one bad competitor shouldn't drop the rest
    }
    for (const keyword of trackedKeywords) {
      const { rank } = rankInRows(keyword, ranked);
      rows.push({ keyword, domain, rank, url: null, captured_on: capturedOn });
    }
  }

  if (rows.length === 0) return 0;

  const { error } = await db.upsert("seo_rank_snapshots", rows, {
    onConflict: "tenant_id,keyword,domain,captured_on",
  });
  if (error) {
    throw new Error(error.message);
  }
  return rows.length;
}

/** Transform raw snapshot rows into the chart + comparison-table shape. */
export function shapeRankHistory(
  rows: RankSnapshotRow[],
  ownDomain: string,
): RankHistoryResponse {
  const own = normalizeDomain(ownDomain);

  const dateSet = new Set<string>();
  const domainSet = new Set<string>();
  // keyword → domain → date → rank
  const byKeyword = new Map<string, Map<string, Map<string, number | null>>>();
  // domain → date → { ctrSum, count }
  const vis = new Map<string, Map<string, { sum: number; count: number }>>();

  for (const r of rows) {
    dateSet.add(r.captured_on);
    domainSet.add(r.domain);

    let domains = byKeyword.get(r.keyword);
    if (!domains) {
      domains = new Map();
      byKeyword.set(r.keyword, domains);
    }
    let dates = domains.get(r.domain);
    if (!dates) {
      dates = new Map();
      domains.set(r.domain, dates);
    }
    dates.set(r.captured_on, r.rank);

    let vdates = vis.get(r.domain);
    if (!vdates) {
      vdates = new Map();
      vis.set(r.domain, vdates);
    }
    const cell = vdates.get(r.captured_on) ?? { sum: 0, count: 0 };
    cell.sum += ctrForRank(r.rank);
    cell.count += 1;
    vdates.set(r.captured_on, cell);
  }

  const dates = Array.from(dateSet).sort();
  // Firm domain first (if present), then competitors alphabetically.
  const domains = Array.from(domainSet).sort((a, b) => {
    if (a === own) return -1;
    if (b === own) return 1;
    return a.localeCompare(b);
  });

  const visibility: Record<string, Record<string, number>> = {};
  for (const [domain, vdates] of vis) {
    visibility[domain] = {};
    for (const [date, { sum, count }] of vdates) {
      visibility[domain][date] = count > 0 ? Math.round((sum / count) * 1000) / 10 : 0;
    }
  }

  const keywords = Array.from(byKeyword.entries())
    .map(([keyword, domainMap]) => {
      const ranks: Record<string, Record<string, number | null>> = {};
      for (const [domain, dateMap] of domainMap) {
        ranks[domain] = Object.fromEntries(dateMap);
      }
      return { keyword, ranks };
    })
    .sort((a, b) => a.keyword.localeCompare(b.keyword));

  return { ownDomain: own, domains, dates, visibility, keywords };
}

/* -------------------------------------------------------------------------- */
/* Reading the history without being truncated                                 */
/* -------------------------------------------------------------------------- */

/**
 * PostgREST answers at most this many rows unless you page.
 *
 * This constant exists because forgetting it caused the bug Diana reported as
 * "the keyword tracker is broken, stuck on June 13". The route asked for 180
 * days of raw snapshots ordered oldest-first with no pagination; at 1,164 rows
 * a day the whole response was one day's data — the oldest day there was. The
 * tracker's own data was complete the entire time.
 */
export const PAGE_SIZE = 1000;

/**
 * Page through a query until it stops returning full pages.
 *
 * Takes a callback that has ALREADY awaited its query and returns plain rows,
 * rather than a Supabase builder. That keeps the generic away from Supabase's
 * builder types, which are deep enough to trip TS2589 when unified with one.
 */
export async function loadPaged<T>(
  page: (from: number, to: number) => Promise<{ rows: T[]; error: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { rows, error } = await page(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error);
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

export type VisibilityRow = {
  domain: string;
  captured_on: string;
  visibility: number;
  sampled: number;
};

/**
 * The response, assembled from the aggregate trend plus the two compared dates.
 *
 * `dates` and `domains` come from the VISIBILITY rows, which cover every day and
 * every domain by construction — so the From/To selectors list the whole history
 * even though only two days of per-keyword detail travel with it.
 */
export function buildRankHistory(args: {
  visibilityRows: VisibilityRow[];
  keywordRows: RankSnapshotRow[];
  ownDomain: string;
}): RankHistoryResponse {
  const own = normalizeDomain(args.ownDomain);

  const dateSet = new Set<string>();
  const domainSet = new Set<string>();
  const visibility: Record<string, Record<string, number>> = {};

  for (const r of args.visibilityRows) {
    dateSet.add(r.captured_on);
    domainSet.add(r.domain);
    (visibility[r.domain] ??= {})[r.captured_on] = Number(r.visibility) || 0;
  }

  const byKeyword = new Map<string, Record<string, Record<string, number | null>>>();
  for (const r of args.keywordRows) {
    const ranks = byKeyword.get(r.keyword) ?? {};
    (ranks[r.domain] ??= {})[r.captured_on] = r.rank;
    byKeyword.set(r.keyword, ranks);
  }

  const dates = [...dateSet].sort();
  const domains = [...domainSet].sort((a, b) => {
    if (a === own) return -1;
    if (b === own) return 1;
    return a.localeCompare(b);
  });
  const keywords = [...byKeyword.entries()]
    .map(([keyword, ranks]) => ({ keyword, ranks }))
    .sort((a, b) => a.keyword.localeCompare(b.keyword));

  return { ownDomain: own, domains, dates, visibility, keywords };
}
