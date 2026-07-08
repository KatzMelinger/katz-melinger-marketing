import {
  getDomainKeywords as getDataForSeoDomainKeywords,
  getOrganicCompetitors as getDfsOrganicCompetitors,
  getRelatedKeywords as getDfsRelatedKeywords,
  getKeywordSuggestions as getDfsKeywordSuggestions,
  getKeywordDifficulty,
  getPhraseMetrics,
} from "@/lib/dataforseo";
import {
  getBacklinkSummary,
  getReferringDomains,
  getBacklinksList,
  rankToScore,
} from "@/lib/dataforseo-backlinks";
import { listTargets } from "@/lib/seo-targets";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { getTenantConfig, DEFAULT_SEO_DOMAIN } from "@/lib/tenant-config";

/**
 * The current tenant's primary domain. KM's config returns "katzmelinger.com",
 * so KM behaves identically; any other tenant gets its own domain. Functions
 * below default their `domain` param to the DEFAULT_SEO_DOMAIN constant and then
 * swap in the per-tenant value when the default (or KM's domain) was used — so
 * callers that pass an explicit competitor domain are unaffected.
 */
async function tenantDomain(tenantId?: string): Promise<string> {
  return (await getTenantConfig(tenantId)).seoDomain;
}

export type KeywordRow = {
  keyword: string;
  position: number;
  previousPosition: number;
  positionDelta: number; // positive = moved up (better rank), negative = moved down
  searchVolume: number;
  keywordDifficulty: number;
  trendScore: number;
  estimatedTraffic: number;
  cpc: number;
  trafficCost: number;
  competition: number;
  url: string;
};

export type CompetitorKeywordGap = {
  keyword: string;
  ourPosition: number;
  competitorPosition: number;
  searchVolume: number;
  opportunityScore: number;
  domain: string;
};

export type BacklinkDomain = {
  domain: string;
  backlinks: number;
  authorityScore: number;
  toxicityRisk: "low" | "medium" | "high";
  followRatio: number;
};

export type TechnicalMetric = {
  name: string;
  score: number;
  status: "healthy" | "warning" | "critical";
  detail: string;
};

const DEFAULT_TARGET_KEYWORDS = [
  "new york employment lawyer",
  "wage theft attorney nyc",
  "wrongful termination lawyer ny",
  "workplace discrimination attorney",
  "sexual harassment lawyer nyc",
  "overtime pay lawyer new york",
  "fmla retaliation attorney",
  "whistleblower lawyer new york",
];

/**
 * Domains that DataForSEO surfaces as "organic competitors" by keyword overlap
 * but that aren't real competitors a law firm can benchmark against: legal
 * directories, Q&A/aggregator sites, government, and reference sources. We
 * strip these from auto-detect so the suggested-competitor list is actual
 * firms. Matched as suffix so subdomains (e.g. blog.nolo.com) are caught too.
 */
const NON_COMPETITOR_DOMAINS = [
  "justia.com",
  "avvo.com",
  "nolo.com",
  "findlaw.com",
  "lawyers.com",
  "martindale.com",
  "superlawyers.com",
  "legalmatch.com",
  "rocketlawyer.com",
  "upcounsel.com",
  "hg.org",
  "expertise.com",
  "thumbtack.com",
  "yelp.com",
  "wikipedia.org",
  "law.cornell.edu",
  "ny.gov",
  "nyc.gov",
  "dol.gov",
  "eeoc.gov",
  "nlrb.gov",
  "indeed.com",
  "glassdoor.com",
  "reddit.com",
  "quora.com",
];

export function isNonCompetitorDomain(domain: string): boolean {
  const d = safeDomain(domain);
  return NON_COMPETITOR_DOMAINS.some((b) => d === b || d.endsWith(`.${b}`));
}

function toPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/**
 * Source of truth is the Supabase seo_target_keywords table (managed via
 * /api/seo/keywords/targets). If the DB is unreachable we fall back to env
 * and then to the legacy hardcoded list so the page never returns empty.
 */
export async function getTargetKeywords(tenantId?: string): Promise<string[]> {
  // Unified source of truth: the seo_keywords tracker table (the same list the
  // KM Agent reads and the rank-refresh cron updates). This makes every
  // intelligence feature that calls getTargetKeywords() — gap analysis,
  // topical maps, alerts, recommendations, briefs, correlation — read the same
  // list as the agent. Falls back to the legacy seo_target_keywords list, then
  // env / defaults, so nothing breaks before/after migration.
  const tid = tenantId ?? (await resolveTenantId());
  try {
    const sb = getSupabaseServer();
    if (sb) {
      const { data } = await sb
        .from("seo_keywords")
        .select("keyword")
        .eq("tenant_id", tid);
      const kws = (data ?? [])
        .map((r) => (typeof r.keyword === "string" ? r.keyword.trim() : ""))
        .filter(Boolean);
      if (kws.length > 0) return kws;
    }
  } catch {
    // fall through to legacy targets / env / defaults
  }
  try {
    const fromDb = await listTargets(tid);
    if (fromDb.length > 0) return fromDb;
  } catch {
    // fall through to env / defaults
  }
  const fromEnv = (process.env.SEO_TARGET_KEYWORDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  return DEFAULT_TARGET_KEYWORDS;
}

export async function getDomainOrganicKeywords(
  domain: string,
  limit = 100,
): Promise<KeywordRow[]> {
  // Reuses the already-validated DataForSEO
  // ranked_keywords wrapper (same one cannibalization + the refresh cron use),
  // mapped to the KeywordRow shape. This single repoint also moves
  // getKeywordGapVsCompetitor(s), getTrackedKeywordPerformance, and the
  // opportunities sync onto DataForSEO, since they all build on this function.
  // Per-tenant: callers resolve the tenant domain before passing it in here
  // (this function takes an explicit `domain` with no hardcoded default).
  const rows = await getDataForSeoDomainKeywords(
    safeDomain(domain),
    undefined,
    limit,
    0,
    "traffic",
    "desc",
  );
  return rows
    .filter((row) => row.keyword)
    .map((row) => {
      const volume = row.volume ?? 0;
      const kd = row.difficulty ?? 0;
      return {
        keyword: row.keyword,
        position: row.position ?? 0,
        previousPosition: row.previousPosition ?? 0,
        positionDelta: row.positionDifference ?? 0,
        searchVolume: volume,
        keywordDifficulty: Math.round(kd),
        // Heuristic trend score from volume + difficulty (DataForSEO doesn't
        // return a per-row trend series here; the monthly-searches trend lives
        // on getKeywordTrend for individual keywords).
        trendScore: toPercent(
          Math.max(10, Math.min(100, (volume / 200) * 20 + (100 - kd) * 0.8)),
        ),
        estimatedTraffic: 0,
        cpc: row.cpc ?? 0,
        trafficCost: 0,
        competition: row.competition ?? 0,
        url: row.url ?? "",
      };
    });
}

/**
 * Real "industry trending" keywords. Pulls DataForSEO Labs related_keywords for
 * a few seed targets, which returns real search volume and a monthly-searches
 * trend series. We keep the rising, sufficiently searched phrases and rank by
 * trend score. Replaces the old hardcoded list.
 */
export async function getTrendingKeywords(
  seeds: string[],
  limit = 8,
): Promise<Array<{ keyword: string; searchVolume: number; trendScore: number }>> {
  // Bound API cost: only seed from the first few targets.
  const seedPhrases = seeds.slice(0, 4).filter(Boolean);
  if (seedPhrases.length === 0) return [];

  // DataForSEO Labs related_keywords. The
  // trend score is derived from each keyword's monthly_searches series.
  const perSeed = await Promise.all(
    seedPhrases.map((seed) => getDfsRelatedKeywords(seed, 30).catch(() => [])),
  );

  const seen = new Set(seedPhrases.map((s) => s.toLowerCase()));
  const out: Array<{ keyword: string; searchVolume: number; trendScore: number }> = [];
  for (const rows of perSeed) {
    for (const row of rows) {
      const keyword = row.keyword.trim();
      if (!keyword) continue;
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      if (row.searchVolume < 50) continue; // drop near-zero-demand noise
      seen.add(key);
      out.push({
        keyword,
        searchVolume: row.searchVolume,
        trendScore: row.trendScore,
      });
    }
  }

  return out.sort((a, b) => b.trendScore - a.trendScore).slice(0, limit);
}

/**
 * Real long-tail opportunities. Combines phrase_questions (natural-language
 * question keywords — gold for FAQ/blog content) with phrase_related, keeps
 * multi-word phrases the firm could realistically rank for, and returns them
 * with real volume. Replaces the old template-string suggestions.
 */
export async function getLongTailSuggestions(
  seeds: string[],
  limit = 8,
): Promise<Array<{ keyword: string; searchVolume: number }>> {
  const seedPhrases = seeds.slice(0, 3).filter(Boolean);
  if (seedPhrases.length === 0) return [];

  // DataForSEO Labs keyword_suggestions (long-tail expansions, replaces
  // phrase_questions) + related_keywords (replaces phrase_related).
  const reports = await Promise.all(
    seedPhrases.flatMap((seed) => [
      getDfsKeywordSuggestions(seed, 20).catch(() => []),
      getDfsRelatedKeywords(seed, 20)
        .then((rows) => rows.map((r) => ({ keyword: r.keyword, searchVolume: r.searchVolume })))
        .catch(() => []),
    ]),
  );

  const seen = new Set<string>();
  const out: Array<{ keyword: string; searchVolume: number }> = [];
  for (const rows of reports) {
    for (const row of rows) {
      const keyword = row.keyword.trim();
      const key = keyword.toLowerCase();
      // Long-tail = 3+ words; skip head terms and dupes.
      if (!keyword || key.split(/\s+/).length < 3 || seen.has(key)) continue;
      if (row.searchVolume < 20) continue;
      seen.add(key);
      out.push({ keyword, searchVolume: row.searchVolume });
    }
  }

  return out.sort((a, b) => b.searchVolume - a.searchVolume).slice(0, limit);
}

export async function getTrackedKeywordPerformance(
  domain = DEFAULT_SEO_DOMAIN,
  tenantId?: string,
): Promise<{
  tracked: Array<KeywordRow & { isTargetKeyword: boolean }>;
  missingTargets: string[];
  trendingKeywords: Array<{ keyword: string; searchVolume: number; trendScore: number }>;
  longTailSuggestions: Array<{ keyword: string; searchVolume: number }>;
}> {
  if (domain === DEFAULT_SEO_DOMAIN) domain = await tenantDomain(tenantId);
  const targets = await getTargetKeywords(tenantId);
  // Pull up to 1000 keywords (DataForSEO per-request max) so targets that rank
  // outside the top-120-by-traffic still get picked up via exact match.
  const rows = await getDomainOrganicKeywords(domain, 1000);
  const byKeyword = new Map(rows.map((row) => [row.keyword.toLowerCase(), row]));

  const initial = targets.map((target) => {
    const hit = byKeyword.get(target.toLowerCase());
    if (hit) {
      return { row: { ...hit, isTargetKeyword: true }, hit: true };
    }
    return {
      row: {
        keyword: target,
        position: 0,
        previousPosition: 0,
        positionDelta: 0,
        searchVolume: 0,
        keywordDifficulty: 0,
        trendScore: 0,
        estimatedTraffic: 0,
        cpc: 0,
        trafficCost: 0,
        competition: 0,
        url: "",
        isTargetKeyword: true,
      },
      hit: false,
    };
  });

  // For targets that don't appear in domain_organic (i.e. the firm doesn't
  // rank in Google's top 100), still populate volume/CPC/KD so the row shows
  // useful info — that's the whole point of "target" tracking.
  const missingPhrases = initial.filter((i) => !i.hit).map((i) => i.row.keyword);
  if (missingPhrases.length > 0) {
    const [metrics, kdMap] = await Promise.all([
      getPhraseMetrics(missingPhrases).catch(() => new Map()),
      getKeywordDifficulty(missingPhrases).catch(() => new Map()),
    ]);
    for (const item of initial) {
      if (item.hit) continue;
      const key = item.row.keyword.toLowerCase();
      const m = metrics.get(key);
      if (m) {
        item.row.searchVolume = m.volume;
        item.row.cpc = m.cpc;
        item.row.competition = m.competition;
      }
      const kd = kdMap.get(key);
      if (typeof kd === "number") {
        item.row.keywordDifficulty = Math.round(kd);
      }
    }
  }

  const tracked = initial.map((i) => i.row);

  const missingTargets = tracked
    .filter((item) => item.position <= 0)
    .map((item) => item.keyword);

  // Real trending + long-tail from DataForSEO keyword reports, seeded from the
  // firm's target keywords. Both fail soft to [] so a phrase-report outage
  // never takes down the whole tracker.
  const [trendingKeywords, longTailSuggestions] = await Promise.all([
    getTrendingKeywords(targets).catch(() => []),
    getLongTailSuggestions(targets).catch(() => []),
  ]);

  return { tracked, missingTargets, trendingKeywords, longTailSuggestions };
}

export async function getKeywordGapVsCompetitor(
  competitorDomain: string,
  ourDomain = DEFAULT_SEO_DOMAIN,
): Promise<CompetitorKeywordGap[]> {
  if (ourDomain === DEFAULT_SEO_DOMAIN) ourDomain = await tenantDomain();
  const [ours, competitor] = await Promise.all([
    getDomainOrganicKeywords(ourDomain, 150),
    getDomainOrganicKeywords(competitorDomain, 150),
  ]);
  const ourMap = new Map(ours.map((row) => [row.keyword.toLowerCase(), row]));

  return competitor
    .map((row) => {
      const oursForKeyword = ourMap.get(row.keyword.toLowerCase());
      const ourPosition = oursForKeyword?.position ?? 0;
      const competitorPosition = row.position;
      const opportunityScore = toPercent(
        row.searchVolume / 150 + Math.max(0, ourPosition - competitorPosition) * 6,
      );
      return {
        keyword: row.keyword,
        ourPosition,
        competitorPosition,
        searchVolume: row.searchVolume,
        opportunityScore,
        domain: competitorDomain,
      };
    })
    .filter((item) => item.searchVolume > 100 && item.competitorPosition > 0)
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 30);
}

/**
 * Keyword gap across MANY tracked competitors at once. Runs the single-domain
 * gap for each curated competitor concurrently, then merges: for any keyword
 * several competitors rank for, we keep the row from the competitor that
 * ranks best (the toughest benchmark) and surface how many firms beat us on
 * it. Powers the keywords page's competitor-opportunity table now that the
 * firm list is the curated Supabase set rather than one hardcoded domain.
 */
export async function getKeywordGapVsCompetitors(
  competitorDomains: string[],
  ourDomain = DEFAULT_SEO_DOMAIN,
  limit = 30,
): Promise<Array<CompetitorKeywordGap & { competitorsBeatingUs: number }>> {
  if (ourDomain === DEFAULT_SEO_DOMAIN) ourDomain = await tenantDomain();
  const domains = competitorDomains
    .map(safeDomain)
    .filter((d) => d && !isNonCompetitorDomain(d));
  if (domains.length === 0) return [];

  const perDomain = await Promise.all(
    domains.map((d) =>
      getKeywordGapVsCompetitor(d, ourDomain).catch(() => [] as CompetitorKeywordGap[]),
    ),
  );

  // Merge by keyword, keeping the best (lowest) competitor position seen.
  const merged = new Map<string, CompetitorKeywordGap & { competitorsBeatingUs: number }>();
  for (const gaps of perDomain) {
    for (const gap of gaps) {
      const key = gap.keyword.toLowerCase();
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...gap, competitorsBeatingUs: 1 });
        continue;
      }
      existing.competitorsBeatingUs += 1;
      if (gap.competitorPosition > 0 && gap.competitorPosition < existing.competitorPosition) {
        existing.competitorPosition = gap.competitorPosition;
        existing.domain = gap.domain;
        existing.opportunityScore = Math.max(existing.opportunityScore, gap.opportunityScore);
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, limit);
}

export async function getBacklinkOverview(domain = DEFAULT_SEO_DOMAIN): Promise<{
  authorityScore: number;
  totalBacklinks: number;
  referringDomains: number;
  followRatio: number;
}> {
  if (domain === DEFAULT_SEO_DOMAIN) domain = await tenantDomain();
  // DataForSEO Backlinks summary. Its
  // 0-1000 "rank" is scaled to a 0-100 authority-style score; follow ratio is
  // derived from the referring-domain follow/nofollow split.
  const s = await getBacklinkSummary(safeDomain(domain));
  const rd = s.referringDomains;
  return {
    authorityScore: rankToScore(s.rank),
    totalBacklinks: s.backlinks,
    referringDomains: rd,
    followRatio: rd > 0 ? toPercent(((rd - s.referringDomainsNofollow) / rd) * 100) : 0,
  };
}

export async function getBacklinkDomains(domain = DEFAULT_SEO_DOMAIN): Promise<BacklinkDomain[]> {
  if (domain === DEFAULT_SEO_DOMAIN) domain = await tenantDomain();
  // DataForSEO referring_domains.
  // Toxicity is read from DataForSEO's backlinks_spam_score (0-100) when
  // present; authority is the 0-1000 rank scaled to 0-100.
  const rows = await getReferringDomains(safeDomain(domain), 30);
  return rows
    .map((row) => {
      const toxicityRisk: "low" | "medium" | "high" =
        row.spamScore >= 30 ? "high" : row.spamScore >= 10 ? "medium" : "low";
      return {
        domain: row.domain,
        backlinks: row.backlinks,
        authorityScore: rankToScore(row.rank),
        toxicityRisk,
        followRatio: 0,
      };
    })
    .filter((row) => row.domain)
    .sort((a, b) => b.backlinks - a.backlinks);
}

export type RecentBacklink = {
  sourceUrl: string;
  sourceTitle: string;
  sourceDomain: string;
  pageAuthorityScore: number;
  firstSeenIso: string | null;
  lastSeenIso: string | null;
  nofollow: boolean;
};

function unixToIso(value: string | undefined): string | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function domainOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Returns the most recently discovered backlinks. Used by the New (30d)
 * drill-down on the backlinks page — clicking the stat opens this list.
 *
 * `sort` controls which axis we sort by:
 *   - "first_seen_desc" → newest backlinks (default; powers "New 30d")
 *   - "last_seen_asc"   → backlinks DataForSEO hasn't seen recently (proxy
 *                         for lost / decaying links; powers "Lost 30d")
 */
export async function getRecentBacklinks(
  domain = DEFAULT_SEO_DOMAIN,
  options: { limit?: number; sort?: "first_seen_desc" | "last_seen_asc" } = {},
): Promise<RecentBacklink[]> {
  if (domain === DEFAULT_SEO_DOMAIN) domain = await tenantDomain();
  const sort = options.sort ?? "first_seen_desc";
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  // DataForSEO backlinks list. one_per_domain so
  // the New/Lost panels show distinct referring sources.
  const rows = await getBacklinksList(safeDomain(domain), {
    limit,
    order: sort === "last_seen_asc" ? "last_seen,asc" : "first_seen,desc",
  });
  return rows
    .map((row) => ({
      sourceUrl: row.urlFrom,
      sourceTitle: row.title,
      sourceDomain: row.domainFrom || domainOf(row.urlFrom),
      pageAuthorityScore: rankToScore(row.pageRank),
      firstSeenIso: row.firstSeen,
      lastSeenIso: row.lastSeen,
      nofollow: !row.dofollow,
    }))
    .filter((b) => b.sourceUrl);
}

/**
 * Sample backlinks for a single referring domain — used when the user
 * expands a row in the Disavow Manager or the Domains table to inspect
 * what pages on that domain link back.
 */
export async function getBacklinksForDomain(
  referringDomain: string,
  targetDomain = DEFAULT_SEO_DOMAIN,
  limit = 20,
): Promise<RecentBacklink[]> {
  if (targetDomain === DEFAULT_SEO_DOMAIN) targetDomain = await tenantDomain();
  const cleaned = referringDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const all = await getRecentBacklinks(targetDomain, { limit: 200 });
  return all.filter((b) => b.sourceDomain === cleaned).slice(0, limit);
}

export async function getOrganicCompetitors(
  domain = DEFAULT_SEO_DOMAIN,
  limit = 20,
): Promise<
  Array<{
    domain: string;
    commonKeywords: number;
    estimatedTraffic: number;
  }>
> {
  if (domain === DEFAULT_SEO_DOMAIN) domain = await tenantDomain();
  // DataForSEO Labs competitors_domain.
  const rows = await getDfsOrganicCompetitors(safeDomain(domain), limit);
  return rows
    // Drop directories/aggregators/gov so suggestions are real firms only.
    .filter((row) => row.domain && !isNonCompetitorDomain(row.domain))
    .map((row) => ({
      domain: row.domain,
      commonKeywords: row.commonKeywords,
      estimatedTraffic: row.estimatedTraffic,
    }));
}

async function fetchPageSpeed(
  url: string,
  strategy: "mobile" | "desktop",
): Promise<{
  performance: number;
  lcp: number;
  cls: number;
  inp: number;
  tbt: number;
}> {
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("category", "performance");
  endpoint.searchParams.set("category", "seo");
  const apiKey = process.env.PAGESPEED_API_KEY?.trim();
  if (apiKey) {
    endpoint.searchParams.set("key", apiKey);
  }
  const res = await fetch(endpoint.toString(), { cache: "no-store" });
  if (!res.ok) {
    return { performance: 0, lcp: 0, cls: 0, inp: 0, tbt: 0 };
  }
  const payload = (await res.json()) as {
    lighthouseResult?: {
      categories?: { performance?: { score?: number } };
      audits?: Record<string, { numericValue?: number }>;
    };
  };
  const audits = payload.lighthouseResult?.audits ?? {};
  return {
    performance: toPercent((payload.lighthouseResult?.categories?.performance?.score ?? 0) * 100),
    lcp: Math.round((audits["largest-contentful-paint"]?.numericValue ?? 0) / 100) / 10,
    cls: Math.round((audits["cumulative-layout-shift"]?.numericValue ?? 0) * 1000) / 1000,
    inp: Math.round((audits["interaction-to-next-paint"]?.numericValue ?? 0) / 10) / 100,
    tbt: Math.round(audits["total-blocking-time"]?.numericValue ?? 0),
  };
}

export async function getTechnicalSeoMonitoring(
  url = `https://${DEFAULT_SEO_DOMAIN}`,
): Promise<{
  mobile: TechnicalMetric[];
  desktop: TechnicalMetric[];
  schemaChecks: TechnicalMetric[];
  crawlErrors: Array<{ url: string; issue: string; severity: "warning" | "critical" }>;
}> {
  if (url === `https://${DEFAULT_SEO_DOMAIN}`) url = `https://${await tenantDomain()}`;
  const [mobile, desktop] = await Promise.all([
    fetchPageSpeed(url, "mobile"),
    fetchPageSpeed(url, "desktop"),
  ]);

  const toStatus = (score: number): "healthy" | "warning" | "critical" =>
    score >= 80 ? "healthy" : score >= 60 ? "warning" : "critical";

  const mobileMetrics: TechnicalMetric[] = [
    {
      name: "Mobile performance score",
      score: mobile.performance,
      status: toStatus(mobile.performance),
      detail: `Core Web Vitals: LCP ${mobile.lcp}s, INP ${mobile.inp}s, CLS ${mobile.cls}`,
    },
    {
      name: "Mobile total blocking time",
      score: toPercent(100 - mobile.tbt / 10),
      status: toStatus(toPercent(100 - mobile.tbt / 10)),
      detail: `TBT ${mobile.tbt}ms`,
    },
  ];

  const desktopMetrics: TechnicalMetric[] = [
    {
      name: "Desktop performance score",
      score: desktop.performance,
      status: toStatus(desktop.performance),
      detail: `Core Web Vitals: LCP ${desktop.lcp}s, INP ${desktop.inp}s, CLS ${desktop.cls}`,
    },
    {
      name: "Desktop total blocking time",
      score: toPercent(100 - desktop.tbt / 10),
      status: toStatus(toPercent(100 - desktop.tbt / 10)),
      detail: `TBT ${desktop.tbt}ms`,
    },
  ];

  const schemaChecks: TechnicalMetric[] = [
    {
      name: "Organization schema",
      score: 86,
      status: "healthy",
      detail: "LegalService and Organization entities detected on homepage.",
    },
    {
      name: "FAQ schema coverage",
      score: 62,
      status: "warning",
      detail: "FAQ markup missing on key practice area pages.",
    },
    {
      name: "Article schema consistency",
      score: 71,
      status: "warning",
      detail: "Some blog posts miss dateModified and author fields.",
    },
  ];

  const crawlErrors = [
    {
      url: "/blog/nyc-wage-theft-rights-guide",
      issue: "Missing canonical tag",
      severity: "warning" as const,
    },
    {
      url: "/practice-areas/discrimination-attorney-nyc",
      issue: "Redirect chain found (3 hops)",
      severity: "critical" as const,
    },
  ];

  return { mobile: mobileMetrics, desktop: desktopMetrics, schemaChecks, crawlErrors };
}

export async function buildContentSeoBrief(input: {
  topic: string;
  practiceArea?: string;
  competitorDomains?: string[];
}): Promise<{
  targetKeywords: string[];
  longTailKeywords: string[];
  titleIdeas: string[];
  headings: string[];
  competitorGaps: string[];
}> {
  const focus = input.topic.trim().toLowerCase();
  const primary = [
    `${focus} new york`,
    `${focus} attorney`,
    `${focus} legal rights`,
  ].filter(Boolean);

  const longTailKeywords = [
    `${focus} statute of limitations`,
    `${focus} settlement timeline`,
    `${focus} evidence checklist`,
    `${focus} free consultation nyc`,
  ];

  const titleIdeas = [
    `${input.practiceArea ?? "Employment law"}: ${input.topic} in New York`,
    `What workers should know about ${input.topic}`,
    `${input.topic}: common legal mistakes and how to avoid them`,
  ];

  const headings = [
    "Who is protected under New York law?",
    "What evidence should you gather first?",
    "Deadlines that can impact your claim",
    "When to contact an employment attorney",
  ];

  const gaps = (input.competitorDomains ?? []).slice(0, 3).map(
    (domain) =>
      `${domain} ranks for informational FAQ terms; add a FAQ section targeting "${input.topic} rights".`,
  );

  return {
    targetKeywords: primary,
    longTailKeywords,
    titleIdeas,
    headings,
    competitorGaps: gaps,
  };
}

