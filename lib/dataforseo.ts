/**
 * DataForSEO helper for MarketOS — the replacement for lib/semrush.ts.
 *
 * Mirrors the public surface of lib/semrush.ts (same function names, same return
 * shapes) so downstream callers — lib/seo-intelligence.ts, lib/opportunity-
 * pipeline.ts, lib/research-packet.ts, the tracked-keyword routes — swap their
 * import path and little else.
 *
 * Key differences from Semrush, all hidden behind these functions:
 *   - Auth is HTTP Basic (login:password), sent as a header by the cache layer.
 *   - Requests are POST + JSON; responses are JSON (no semicolon-CSV parsing).
 *   - Data comes from the DataForSEO Labs API (Google database):
 *       getDomainKeywords     -> dataforseo_labs/google/ranked_keywords/live
 *       getKeywordDifficulty  -> dataforseo_labs/google/bulk_keyword_difficulty/live
 *       getPhraseMetrics      -> dataforseo_labs/google/keyword_overview/live
 *       getKeywordTrend       -> dataforseo_labs/google/keyword_overview/live
 *                                (keyword_info.monthly_searches)
 *
 * Geography: DataForSEO uses numeric location_code + ISO language_code instead
 * of Semrush's "us" database string. We default to United States / English; the
 * legacy `database` parameter is accepted for signature-compatibility and
 * ignored.
 */

import { cachedDataForSeoPost } from "./dataforseo-cache";

// ============================================================================
// Constants — mirror SEMRUSH_DOMAIN / SEMRUSH_DATABASE
// ============================================================================

export const DATAFORSEO_DOMAIN = "katzmelinger.com";
/** United States. DataForSEO location codes: 2840 = US. */
export const DATAFORSEO_LOCATION_CODE = 2840;
export const DATAFORSEO_LANGUAGE_CODE = "en";

// ============================================================================
// Types — structurally identical to SemrushKeywordRow for drop-in swap
// ============================================================================

export type DataForSeoKeywordRow = {
  keyword: string;
  position: number | null;
  previousPosition: number | null;
  positionDifference: number | null;
  volume: number | null;
  cpc: number | null;
  url: string | null;
  trafficPercent: number | null;
  competition: number | null;
  numberOfResults: number | null;
  difficulty: number | null;
};

// ============================================================================
// Low-level helpers
// ============================================================================

/** Pull tasks[0].result[0].items[] defensively from a DataForSEO response. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractItems(json: any): any[] {
  const result = json?.tasks?.[0]?.result;
  if (!Array.isArray(result) || result.length === 0) return [];
  const items = result[0]?.items;
  return Array.isArray(items) ? items : [];
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Map our generic sort keys to DataForSEO Labs order_by expressions. */
function mapOrderBy(
  sortBy: string | undefined,
  sortDir: "asc" | "desc" | undefined,
): string {
  const dir = sortDir === "asc" ? "asc" : "desc";
  const map: Record<string, string> = {
    traffic: `ranked_serp_element.serp_item.etv,${dir}`,
    position: `ranked_serp_element.serp_item.rank_group,${dir}`,
    volume: `keyword_data.keyword_info.search_volume,${dir}`,
    cpc: `keyword_data.keyword_info.cpc,${dir}`,
    competition: `keyword_data.keyword_info.competition,${dir}`,
  };
  return map[sortBy ?? "traffic"] ?? `ranked_serp_element.serp_item.etv,${dir}`;
}

// ============================================================================
// Public API — mirrors lib/semrush.ts
// ============================================================================

/**
 * Keywords the domain currently ranks for in Google's organic results.
 * Replacement for Semrush's domain_organic report.
 *
 * Note: unlike Semrush's domain_organic (which left difficulty null), DataForSEO
 * returns keyword difficulty inline, so `difficulty` is populated here.
 */
export async function getDomainKeywords(
  domain: string | undefined,
  _database: string | undefined,
  limit: number = 200,
  offset: number = 0,
  sortBy: string = "traffic",
  sortDir: "asc" | "desc" = "desc",
): Promise<DataForSeoKeywordRow[]> {
  const json = await cachedDataForSeoPost(
    "dataforseo_labs/google/ranked_keywords/live",
    {
      target: domain ?? DATAFORSEO_DOMAIN,
      location_code: DATAFORSEO_LOCATION_CODE,
      language_code: DATAFORSEO_LANGUAGE_CODE,
      limit: Math.min(Math.max(limit, 1), 1000),
      offset: Math.max(offset, 0),
      order_by: [mapOrderBy(sortBy, sortDir)],
      // Organic SERP results only (exclude paid / SERP features).
      filters: [["ranked_serp_element.serp_item.type", "=", "organic"]],
    },
  );

  return extractItems(json).map((item) => {
    const kd = item?.keyword_data ?? {};
    const info = kd?.keyword_info ?? {};
    const props = kd?.keyword_properties ?? {};
    const serp = item?.ranked_serp_element?.serp_item ?? {};
    return {
      keyword: kd?.keyword ?? "",
      position: toNum(serp?.rank_group),
      previousPosition: null, // available via historical endpoints, not inline
      positionDifference: null,
      volume: toNum(info?.search_volume),
      cpc: toNum(info?.cpc),
      url: serp?.url ?? null,
      trafficPercent: null,
      competition: toNum(info?.competition),
      numberOfResults: toNum(serp?.se_results_count),
      difficulty: toNum(props?.keyword_difficulty),
    };
  });
}

/**
 * Keyword difficulty (0-100) for one or more phrases.
 * Replacement for Semrush's phrase_kdi report.
 * Returns a map of lowercase keyword -> difficulty.
 */
export async function getKeywordDifficulty(
  phrases: string[],
  _database?: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (phrases.length === 0) return out;

  // bulk_keyword_difficulty accepts up to 1000 keywords per call; chunk at 1000.
  for (let i = 0; i < phrases.length; i += 1000) {
    const chunk = phrases.slice(i, i + 1000);
    try {
      const json = await cachedDataForSeoPost(
        "dataforseo_labs/google/bulk_keyword_difficulty/live",
        {
          keywords: chunk,
          location_code: DATAFORSEO_LOCATION_CODE,
          language_code: DATAFORSEO_LANGUAGE_CODE,
        },
      );
      for (const item of extractItems(json)) {
        const phrase = String(item?.keyword ?? "").toLowerCase().trim();
        const kd = toNum(item?.keyword_difficulty);
        if (phrase && kd !== null) out.set(phrase, kd);
      }
    } catch {
      // skip this chunk, keep going
    }
  }

  return out;
}

/**
 * Search volume / CPC / competition for arbitrary phrases (including ones the
 * domain doesn't rank for). Replacement for Semrush's phrase_these report.
 * Returns a map of lowercase keyword -> metrics.
 */
export async function getPhraseMetrics(
  phrases: string[],
  _database?: string,
): Promise<Map<string, { volume: number; cpc: number; competition: number }>> {
  const out = new Map<string, { volume: number; cpc: number; competition: number }>();
  if (phrases.length === 0) return out;

  // keyword_overview accepts up to 700 keywords per call; chunk at 700.
  for (let i = 0; i < phrases.length; i += 700) {
    const chunk = phrases.slice(i, i + 700);
    try {
      const json = await cachedDataForSeoPost(
        "dataforseo_labs/google/keyword_overview/live",
        {
          keywords: chunk,
          location_code: DATAFORSEO_LOCATION_CODE,
          language_code: DATAFORSEO_LANGUAGE_CODE,
        },
      );
      for (const item of extractItems(json)) {
        const phrase = String(item?.keyword ?? "").toLowerCase().trim();
        const info = item?.keyword_info ?? {};
        if (!phrase) continue;
        out.set(phrase, {
          volume: toNum(info?.search_volume) ?? 0,
          cpc: toNum(info?.cpc) ?? 0,
          competition: toNum(info?.competition) ?? 0,
        });
      }
    } catch {
      // skip this chunk, keep going
    }
  }

  return out;
}

/**
 * 12-month search-interest trend for a keyword, from keyword_overview's
 * keyword_info.monthly_searches array. Replacement for Semrush's phrase_this
 * (Td) trend. Returns monthly absolute search volumes (oldest first), the
 * headline search volume, and a derived direction.
 */
export async function getKeywordTrend(
  keyword: string,
  _database?: string,
): Promise<{
  keyword: string;
  searchVolume: number | null;
  trend: number[];
  direction: "rising" | "stable" | "falling" | "unknown";
}> {
  const empty = {
    keyword,
    searchVolume: null as number | null,
    trend: [] as number[],
    direction: "unknown" as const,
  };

  try {
    const json = await cachedDataForSeoPost(
      "dataforseo_labs/google/keyword_overview/live",
      {
        keywords: [keyword],
        location_code: DATAFORSEO_LOCATION_CODE,
        language_code: DATAFORSEO_LANGUAGE_CODE,
      },
    );
    const item = extractItems(json)[0];
    if (!item) return empty;

    const info = item?.keyword_info ?? {};
    const searchVolume = toNum(info?.search_volume);

    // monthly_searches: [{ year, month, search_volume }], most-recent first.
    // Reverse to oldest-first to match the Semrush trend convention.
    const monthly: Array<{ year: number; month: number; search_volume: number | null }> =
      Array.isArray(info?.monthly_searches) ? info.monthly_searches : [];
    const trend = monthly
      .slice()
      .reverse()
      .map((m) => toNum(m?.search_volume))
      .filter((n): n is number => n !== null);

    let direction: "rising" | "stable" | "falling" | "unknown" = "unknown";
    if (trend.length >= 6) {
      const avg = (xs: number[]) =>
        xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      const first = avg(trend.slice(0, 3));
      const last = avg(trend.slice(-3));
      if (first > 0) {
        const ratio = last / first;
        direction = ratio > 1.1 ? "rising" : ratio < 0.9 ? "falling" : "stable";
      } else if (last > 0) {
        direction = "rising";
      }
    }

    return { keyword, searchVolume, trend, direction };
  } catch {
    return empty;
  }
}

/**
 * Live SERP rank for a single keyword — the accuracy fallback for tracked
 * keywords. The Labs `ranked_keywords` snapshot can lag live SERPs and miss
 * keywords the domain actually ranks for (confirmed during the parity check:
 * "adverse treatment" absent from the snapshot but live-ranked #8). This hits
 * a real-time Google SERP and finds the target domain's position.
 *
 * Returns the organic rank (rank_group) or null if the domain isn't in the
 * top `depth` results. ~$0.002 per call — use only for the bounded set of
 * tracked keywords missing from the snapshot, not for bulk discovery.
 */
export async function getLiveRank(
  keyword: string,
  domain: string = DATAFORSEO_DOMAIN,
  depth: number = 100,
): Promise<number | null> {
  const target = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  try {
    const json = await cachedDataForSeoPost("serp/google/organic/live/regular", {
      keyword,
      location_code: DATAFORSEO_LOCATION_CODE,
      language_code: DATAFORSEO_LANGUAGE_CODE,
      depth: Math.min(Math.max(depth, 10), 100),
    });
    for (const item of extractItems(json)) {
      const d = String(item?.domain ?? "").toLowerCase();
      if (d === target || d.endsWith(`.${target}`)) {
        return toNum(item?.rank_group);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Look up a single keyword on the firm's domain — used by the "add tracked
 * keyword" flow to populate initial rank / volume / difficulty / url.
 * Same logic as the Semrush version: try the ranked set first, fall back to
 * phrase metrics + difficulty if the domain doesn't rank for it.
 */
export async function lookupKeywordRanking(
  keyword: string,
  domain: string = DATAFORSEO_DOMAIN,
): Promise<{
  currentRank: number | null;
  searchVolume: number | null;
  difficulty: number | null;
  url: string | null;
}> {
  const normalized = keyword.toLowerCase().trim();

  try {
    const all = await getDomainKeywords(domain, undefined, 1000, 0, "traffic", "desc");

    const exact = all.find((kw) => kw.keyword.toLowerCase().trim() === normalized);
    const partial =
      exact ??
      all.find(
        (kw) =>
          kw.keyword.toLowerCase().includes(normalized) ||
          normalized.includes(kw.keyword.toLowerCase()),
      );

    if (!partial) {
      const [metricsMap, kdMap] = await Promise.all([
        getPhraseMetrics([keyword]).catch(() => new Map()),
        getKeywordDifficulty([keyword]).catch(() => new Map()),
      ]);
      const m = metricsMap.get(normalized);
      const difficulty = kdMap.get(normalized) ?? null;
      return {
        currentRank: null,
        searchVolume: m ? m.volume : null,
        difficulty,
        url: null,
      };
    }

    let difficulty = partial.difficulty;
    if (difficulty === null) {
      const kdMap = await getKeywordDifficulty([partial.keyword]);
      difficulty = kdMap.get(partial.keyword.toLowerCase().trim()) ?? null;
    }

    return {
      currentRank: partial.position,
      searchVolume: partial.volume,
      difficulty,
      url: partial.url,
    };
  } catch {
    return { currentRank: null, searchVolume: null, difficulty: null, url: null };
  }
}

/**
 * Detect a Google AI Overview for a keyword and whether our domain is cited in
 * it. Uses the SERP advanced endpoint, whose items[] include an `ai_overview`
 * element with reference links.
 *
 * SCHEMA NOTE: field paths follow DataForSEO's documented SERP-advanced shape
 * but couldn't be verified against a live response (this environment can't reach
 * the API). Parsing is defensive — unknown shapes yield present:false. Validate
 * the ai_overview element via scripts/dfs-schema-probe.mjs from a reachable
 * network, then adjust if needed.
 */
export async function getAIOverviewForKeyword(
  keyword: string,
  ourDomain: string = DATAFORSEO_DOMAIN,
): Promise<{ present: boolean; cited: boolean; sources: string[] }> {
  const ours = ourDomain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const empty = { present: false, cited: false, sources: [] as string[] };
  try {
    const json = await cachedDataForSeoPost("serp/google/organic/live/advanced", {
      keyword,
      location_code: DATAFORSEO_LOCATION_CODE,
      language_code: DATAFORSEO_LANGUAGE_CODE,
      depth: 20,
    });
    const ao = extractItems(json).find((it) => it?.type === "ai_overview");
    if (!ao) return empty;

    // References can be a flat `references[]` or nested under `items[].references`.
    const refs = Array.isArray(ao.references)
      ? ao.references
      : Array.isArray(ao.items)
        ? ao.items.flatMap((s: { references?: unknown }) =>
            Array.isArray(s?.references) ? s.references : [],
          )
        : [];

    const sources = Array.from(
      new Set(
        refs
          .map((r: { url?: unknown; domain?: unknown }) => {
            const raw = String(r?.url ?? r?.domain ?? "");
            try {
              return new URL(raw).host.replace(/^www\./, "").toLowerCase();
            } catch {
              return String(r?.domain ?? "").replace(/^www\./, "").toLowerCase();
            }
          })
          .filter((d: string) => d.length > 0),
      ),
    ) as string[];

    const cited = sources.some((d) => d === ours || d.endsWith(`.${ours}`));
    return { present: true, cited, sources };
  } catch {
    return empty;
  }
}

// ============================================================================
// Competitor + related-keyword wrappers (replace Semrush domain_organic_organic
// / phrase_related / phrase_questions). Field paths follow DataForSEO Labs'
// documented shapes; parsing is defensive. Validate with
// scripts/dfs-schema-probe.mjs from a DataForSEO-reachable network.
// ============================================================================

/** 0-100 trend score from a monthly_searches array (most-recent first). */
function monthlyTrendScore(monthly: unknown): number {
  const arr = Array.isArray(monthly) ? monthly : [];
  const series = arr
    .slice()
    .reverse()
    .map((m) => toNum((m as { search_volume?: unknown })?.search_volume))
    .filter((n): n is number => n !== null);
  if (series.length < 4) return 50;
  const mid = Math.floor(series.length / 2);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const front = avg(series.slice(0, mid)) || 0.01;
  const back = avg(series.slice(mid));
  const growth = (back - front) / front;
  return Math.round(Math.min(100, Math.max(0, 50 + growth * 40)));
}

/**
 * Organic competitors for a domain. Replacement for Semrush
 * domain_organic_organic. `intersections` = number of shared ranking keywords.
 */
export async function getOrganicCompetitors(
  domain: string | undefined,
  limit: number = 20,
): Promise<Array<{ domain: string; commonKeywords: number; estimatedTraffic: number }>> {
  const json = await cachedDataForSeoPost(
    "dataforseo_labs/google/competitors_domain/live",
    {
      target: domain ?? DATAFORSEO_DOMAIN,
      location_code: DATAFORSEO_LOCATION_CODE,
      language_code: DATAFORSEO_LANGUAGE_CODE,
      limit: Math.min(Math.max(limit, 1), 1000),
      item_types: ["organic"],
    },
  );
  return extractItems(json)
    .map((it) => {
      const organic = it?.metrics?.organic ?? it?.full_domain_metrics?.organic ?? {};
      return {
        domain: String(it?.domain ?? "").replace(/^www\./, "").toLowerCase(),
        commonKeywords: toNum(it?.intersections) ?? 0,
        estimatedTraffic: Math.round(toNum(organic?.etv) ?? 0),
      };
    })
    .filter((c) => c.domain);
}

/** Related keywords for a seed (with a trend score). Replaces phrase_related. */
export async function getRelatedKeywords(
  seed: string,
  limit: number = 30,
): Promise<Array<{ keyword: string; searchVolume: number; trendScore: number }>> {
  const json = await cachedDataForSeoPost(
    "dataforseo_labs/google/related_keywords/live",
    {
      keyword: seed,
      location_code: DATAFORSEO_LOCATION_CODE,
      language_code: DATAFORSEO_LANGUAGE_CODE,
      limit: Math.min(Math.max(limit, 1), 1000),
      depth: 1,
    },
  );
  return extractItems(json)
    .map((it) => {
      const kd = it?.keyword_data ?? it;
      const info = kd?.keyword_info ?? {};
      return {
        keyword: String(kd?.keyword ?? "").trim(),
        searchVolume: toNum(info?.search_volume) ?? 0,
        trendScore: monthlyTrendScore(info?.monthly_searches),
      };
    })
    .filter((k) => k.keyword);
}

/** Long-tail keyword suggestions for a seed. Replaces phrase_questions. */
export async function getKeywordSuggestions(
  seed: string,
  limit: number = 30,
): Promise<Array<{ keyword: string; searchVolume: number }>> {
  const json = await cachedDataForSeoPost(
    "dataforseo_labs/google/keyword_suggestions/live",
    {
      keyword: seed,
      location_code: DATAFORSEO_LOCATION_CODE,
      language_code: DATAFORSEO_LANGUAGE_CODE,
      limit: Math.min(Math.max(limit, 1), 1000),
    },
  );
  return extractItems(json)
    .map((it) => {
      const kd = it?.keyword_data ?? it;
      const info = kd?.keyword_info ?? it?.keyword_info ?? {};
      return {
        keyword: String(kd?.keyword ?? it?.keyword ?? "").trim(),
        searchVolume: toNum(info?.search_volume) ?? 0,
      };
    })
    .filter((k) => k.keyword);
}
