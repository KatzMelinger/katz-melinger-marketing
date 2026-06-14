/**
 * DataForSEO implementations of the SEO-intelligence reports that still ran on
 * Semrush (backlinks, referring domains, recent backlinks, organic competitors,
 * organic keywords). These are the DataForSEO half of the SEMrush→DataForSEO
 * migration; lib/seo-intelligence.ts calls them FIRST and falls back to its
 * existing Semrush implementations when they return empty/throw — so nothing
 * regresses if the DataForSEO Backlinks API (a separate paid subscription) isn't
 * enabled.
 *
 * Return shapes are plain objects that structurally match the seo-intelligence
 * types (KeywordRow / BacklinkDomain / RecentBacklink / competitor rows) so the
 * caller can use them directly without a circular import.
 *
 * ⚠️ The backlinks endpoints (backlinks/*) require DataForSEO's Backlinks API.
 * Response-field mapping follows DataForSEO's documented schema but has NOT been
 * verified against a live paid account — verify in prod, the fallback covers it.
 */

import { cachedDataForSeoPost, isDataForSeoOk } from "./dataforseo-cache";
import { getDomainKeywords, DATAFORSEO_LOCATION_CODE, DATAFORSEO_LANGUAGE_CODE } from "./dataforseo";

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** result[0].items[] from a DataForSEO response, or [] defensively. */
function items(json: unknown): any[] {
  const result = (json as any)?.tasks?.[0]?.result;
  if (!Array.isArray(result) || result.length === 0) return [];
  const it = result[0]?.items;
  return Array.isArray(it) ? it : [];
}
/** result[0] object from a DataForSEO response, or null defensively. */
function firstResult(json: unknown): any | null {
  const result = (json as any)?.tasks?.[0]?.result;
  return Array.isArray(result) && result.length > 0 ? result[0] : null;
}

const cleanDomain = (d: string) =>
  d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();

// ---- Organic keywords (KeywordRow[]) — maps the proven ranked_keywords call --

export type DfsKeywordRow = {
  keyword: string;
  position: number;
  previousPosition: number;
  positionDelta: number;
  searchVolume: number;
  keywordDifficulty: number;
  trendScore: number;
  estimatedTraffic: number;
  cpc: number;
  trafficCost: number;
  competition: number;
  url: string;
};

export async function dfsOrganicKeywords(domain: string, limit = 100): Promise<DfsKeywordRow[]> {
  const rows = await getDomainKeywords(domain, undefined, limit, 0, "traffic", "desc");
  return rows.map((r) => ({
    keyword: r.keyword,
    position: r.position ?? 0,
    previousPosition: r.previousPosition ?? 0,
    positionDelta: r.positionDifference ?? 0,
    searchVolume: r.volume ?? 0,
    keywordDifficulty: r.difficulty ?? 0,
    trendScore: 0,
    estimatedTraffic: 0,
    cpc: r.cpc ?? 0,
    trafficCost: 0,
    competition: r.competition ?? 0,
    url: r.url ?? "",
  }));
}

// ---- Backlinks summary (BacklinkOverview) --------------------------------

export async function dfsBacklinkOverview(domain: string): Promise<{
  authorityScore: number;
  totalBacklinks: number;
  referringDomains: number;
  followRatio: number;
} | null> {
  const json = await cachedDataForSeoPost("backlinks/summary/live", {
    target: cleanDomain(domain),
    internal_list_limit: 1,
    backlinks_status_type: "live",
  });
  if (!isDataForSeoOk(json)) return null;
  const r = firstResult(json);
  if (!r) return null;
  const total = toNum(r.backlinks);
  const dofollow = toNum(r.referring_links_attributes?.dofollow ?? r.backlinks_dofollow);
  // DataForSEO domain `rank` is 0-1000; scale to a 0-100 authority score.
  const rank = toNum(r.rank);
  return {
    authorityScore: Math.round(rank / 10),
    totalBacklinks: total,
    referringDomains: toNum(r.referring_domains),
    followRatio: total > 0 && dofollow > 0 ? Math.round((dofollow / total) * 100) : 0,
  };
}

// ---- Referring domains (BacklinkDomain[]) -------------------------------

export async function dfsBacklinkDomains(domain: string, limit = 30): Promise<
  Array<{
    domain: string;
    backlinks: number;
    authorityScore: number;
    toxicityRisk: "low" | "medium" | "high";
    followRatio: number;
  }>
> {
  const json = await cachedDataForSeoPost("backlinks/referring_domains/live", {
    target: cleanDomain(domain),
    limit,
    order_by: ["backlinks,desc"],
    backlinks_status_type: "live",
  });
  if (!isDataForSeoOk(json)) return [];
  return items(json)
    .map((it) => {
      const rank = toNum(it.rank); // 0-1000
      const authorityScore = Math.round(rank / 10);
      const toxicityRisk: "low" | "medium" | "high" =
        authorityScore >= 40 ? "low" : authorityScore >= 20 ? "medium" : "high";
      return {
        domain: String(it.domain ?? ""),
        backlinks: toNum(it.backlinks),
        authorityScore,
        toxicityRisk,
        followRatio: 0,
      };
    })
    .filter((r) => r.domain);
}

// ---- Recent backlinks (RecentBacklink[]) --------------------------------

export type DfsRecentBacklink = {
  sourceUrl: string;
  sourceTitle: string;
  sourceDomain: string;
  pageAuthorityScore: number;
  firstSeenIso: string | null;
  lastSeenIso: string | null;
  nofollow: boolean;
};

function isoOf(v: unknown): string | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function dfsRecentBacklinks(
  domain: string,
  options: { limit?: number; sort?: "first_seen_desc" | "last_seen_asc" } = {},
): Promise<DfsRecentBacklink[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const order =
    options.sort === "last_seen_asc" ? "last_seen,asc" : "first_seen,desc";
  const json = await cachedDataForSeoPost("backlinks/backlinks/live", {
    target: cleanDomain(domain),
    limit,
    mode: "as_is",
    order_by: [order],
    backlinks_status_type: "live",
  });
  if (!isDataForSeoOk(json)) return [];
  return items(json)
    .map((it) => {
      const sourceUrl = String(it.url_from ?? "");
      return {
        sourceUrl,
        sourceTitle: String(it.page_from_title ?? ""),
        sourceDomain: cleanDomain(String(it.domain_from ?? sourceUrl)),
        pageAuthorityScore: Math.round(toNum(it.rank) / 10),
        firstSeenIso: isoOf(it.first_seen),
        lastSeenIso: isoOf(it.last_seen ?? it.prev_seen),
        nofollow: it.dofollow === false,
      };
    })
    .filter((b) => b.sourceUrl);
}

// ---- Organic competitors -------------------------------------------------

export async function dfsOrganicCompetitors(
  domain: string,
  limit = 20,
): Promise<Array<{ domain: string; commonKeywords: number; estimatedTraffic: number }>> {
  const json = await cachedDataForSeoPost("dataforseo_labs/google/competitors_domain/live", {
    target: cleanDomain(domain),
    location_code: DATAFORSEO_LOCATION_CODE,
    language_code: DATAFORSEO_LANGUAGE_CODE,
    limit,
    order_by: ["intersections,desc"],
  });
  if (!isDataForSeoOk(json)) return [];
  return items(json)
    .map((it) => {
      const organic = it.competitor_metrics?.organic ?? it.full_domain_metrics?.organic ?? {};
      return {
        domain: String(it.domain ?? ""),
        commonKeywords: toNum(it.intersections),
        estimatedTraffic: Math.round(toNum(organic.etv)),
      };
    })
    .filter((c) => c.domain && c.domain !== cleanDomain(domain));
}
