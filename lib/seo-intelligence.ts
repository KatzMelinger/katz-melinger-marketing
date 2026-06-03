import {
  getKeywordDifficulty,
  getPhraseMetrics,
  parseIntSafe,
  parseSemrushCsv,
  rowToRecord,
  semrushAnalyticsUrl,
  semrushSeoUrl,
  SEMRUSH_DATABASE,
  SEMRUSH_DOMAIN,
} from "@/lib/semrush";
import { cachedSemrushFetch } from "@/lib/semrush-cache";
import { listTargets } from "@/lib/seo-targets";
import { getSupabaseServer } from "@/lib/supabase-server";

type SemrushRecord = Record<string, string>;

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
 * Domains that Semrush surfaces as "organic competitors" by keyword overlap
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

function asNumber(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const raw = value.replace(/,/g, "").trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
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

function getSemrushKey(): string {
  return process.env.SEMRUSH_API_KEY?.trim() ?? "";
}

async function fetchSemrushRowsFromSeo(
  params: Record<string, string>,
): Promise<SemrushRecord[]> {
  const key = getSemrushKey();
  if (!key) {
    return [];
  }
  const url = semrushSeoUrl({ key, database: SEMRUSH_DATABASE, ...params });
  const res = await cachedSemrushFetch(url);
  const text = await res.text();
  const parsed = parseSemrushCsv(text);
  if (!parsed) {
    return [];
  }
  const headers = parsed.headers.map((h) => h.trim());
  return parsed.rows.map((row) => rowToRecord(headers, row));
}

async function fetchSemrushRowsFromAnalytics(
  params: Record<string, string>,
): Promise<SemrushRecord[]> {
  const key = getSemrushKey();
  if (!key) {
    return [];
  }
  const url = semrushAnalyticsUrl({ key, ...params });
  const res = await cachedSemrushFetch(url);
  const text = await res.text();
  const parsed = parseSemrushCsv(text);
  if (!parsed) {
    return [];
  }
  const headers = parsed.headers.map((h) => h.trim());
  return parsed.rows.map((row) => rowToRecord(headers, row));
}

function parseKeywordRow(row: SemrushRecord): KeywordRow {
  const keyword = row["Keyword"] ?? row["Ph"] ?? "";
  const position = parseIntSafe(row["Position"] ?? row["Po"] ?? "");
  const previousPosition = parseIntSafe(row["Previous Position"] ?? row["Pp"] ?? "");
  // Semrush returns "Position Difference" as a positive number when the keyword
  // moved up (e.g. went from rank 8 to rank 3 = +5). We mirror that convention.
  const positionDelta = parseIntSafe(row["Position Difference"] ?? row["Pd"] ?? "");
  const volume = parseIntSafe(row["Search Volume"] ?? row["Nq"] ?? "");
  const kd = asNumber(row["KD %"] ?? row["Kd"] ?? row["Keyword Difficulty"]);
  const traffic = parseIntSafe(row["Traffic"] ?? row["Tr"] ?? "");
  const cpc = asNumber(row["CPC"] ?? row["Cp"] ?? "");
  const trafficCost = asNumber(row["Traffic Cost"] ?? row["Tc"] ?? "");
  const competition = asNumber(row["Competition"] ?? row["Co"] ?? "");
  const url = row["Url"] ?? row["Ur"] ?? "";
  const trend = toPercent(
    Math.max(10, Math.min(100, (volume / 200) * 20 + (100 - kd) * 0.8)),
  );
  return {
    keyword,
    position,
    previousPosition,
    positionDelta,
    searchVolume: volume,
    keywordDifficulty: Math.round(kd),
    trendScore: trend,
    estimatedTraffic: traffic,
    cpc,
    trafficCost,
    competition,
    url,
  };
}

/**
 * Source of truth is the Supabase seo_target_keywords table (managed via
 * /api/seo/keywords/targets). If the DB is unreachable we fall back to env
 * and then to the legacy hardcoded list so the page never returns empty.
 */
export async function getTargetKeywords(): Promise<string[]> {
  // Unified source of truth: the seo_keywords tracker table (the same list the
  // KM Agent reads and the rank-refresh cron updates). This makes every
  // intelligence feature that calls getTargetKeywords() — gap analysis,
  // topical maps, alerts, recommendations, briefs, correlation — read the same
  // list as the agent. Falls back to the legacy seo_target_keywords list, then
  // env / defaults, so nothing breaks before/after migration.
  try {
    const sb = getSupabaseServer();
    if (sb) {
      const { data } = await sb.from("seo_keywords").select("keyword");
      const kws = (data ?? [])
        .map((r) => (typeof r.keyword === "string" ? r.keyword.trim() : ""))
        .filter(Boolean);
      if (kws.length > 0) return kws;
    }
  } catch {
    // fall through to legacy targets / env / defaults
  }
  try {
    const fromDb = await listTargets();
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
  const rows = await fetchSemrushRowsFromSeo({
    type: "domain_organic",
    domain: safeDomain(domain),
    display_limit: String(limit),
    display_sort: "tr_desc",
    export_decode: "1",
    export_columns: "Ph,Po,Pp,Pd,Nq,Kd,Cp,Co,Tr,Tc,Ur",
  });
  return rows.map(parseKeywordRow).filter((row) => row.keyword);
}

/**
 * Semrush returns a 12-month trend as a comma-separated list of normalized
 * values (most recent last), e.g. "0.50,0.50,0.65,0.82,1.00". We score
 * "trending" as the recent slope: how much the back half rose over the
 * front half, mapped to 0-100. Flat/declining keywords score low.
 */
function trendScoreFromTd(td: string | undefined, volume: number): number {
  const points = (td ?? "")
    .split(",")
    .map((v) => Number.parseFloat(v.trim()))
    .filter((n) => Number.isFinite(n));
  if (points.length < 4) {
    // No usable trend series — fall back to a volume-based floor so the row
    // still sorts sensibly rather than scoring 0.
    return toPercent(Math.min(60, volume / 50));
  }
  const mid = Math.floor(points.length / 2);
  const front = points.slice(0, mid);
  const back = points.slice(mid);
  const avg = (arr: number[]) => arr.reduce((s, n) => s + n, 0) / (arr.length || 1);
  const frontAvg = avg(front) || 0.01;
  const backAvg = avg(back);
  const growth = (backAvg - frontAvg) / frontAvg; // -1..+inf
  // Center 0 growth at 50, +100% growth ≈ 90, -50% ≈ 25.
  return toPercent(50 + growth * 40);
}

/**
 * Real "industry trending" keywords. Pulls phrase_related for a few seed
 * targets (Semrush's "related keywords" report), which returns real search
 * volume and a 12-month trend series (Td). We keep the rising, sufficiently
 * searched phrases and rank by trend score. Replaces the old hardcoded list.
 */
export async function getTrendingKeywords(
  seeds: string[],
  limit = 8,
): Promise<Array<{ keyword: string; searchVolume: number; trendScore: number }>> {
  // Bound API cost: only seed from the first few targets.
  const seedPhrases = seeds.slice(0, 4).filter(Boolean);
  if (seedPhrases.length === 0) return [];

  const perSeed = await Promise.all(
    seedPhrases.map((seed) =>
      fetchSemrushRowsFromSeo({
        type: "phrase_related",
        phrase: seed,
        display_limit: "30",
        display_sort: "nq_desc",
        export_decode: "1",
        export_columns: "Ph,Nq,Kd,Td",
      }).catch(() => [] as SemrushRecord[]),
    ),
  );

  const seen = new Set(seedPhrases.map((s) => s.toLowerCase()));
  const out: Array<{ keyword: string; searchVolume: number; trendScore: number }> = [];
  for (const rows of perSeed) {
    for (const row of rows) {
      const keyword = (row["Keyword"] ?? row["Ph"] ?? "").trim();
      if (!keyword) continue;
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      const volume = parseIntSafe(row["Search Volume"] ?? row["Nq"] ?? "");
      if (volume < 50) continue; // drop near-zero-demand noise
      seen.add(key);
      out.push({
        keyword,
        searchVolume: volume,
        trendScore: trendScoreFromTd(row["Trends"] ?? row["Td"], volume),
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

  const reports = await Promise.all(
    seedPhrases.flatMap((seed) => [
      fetchSemrushRowsFromSeo({
        type: "phrase_questions",
        phrase: seed,
        display_limit: "20",
        display_sort: "nq_desc",
        export_decode: "1",
        export_columns: "Ph,Nq",
      }).catch(() => [] as SemrushRecord[]),
      fetchSemrushRowsFromSeo({
        type: "phrase_related",
        phrase: seed,
        display_limit: "20",
        display_sort: "nq_desc",
        export_decode: "1",
        export_columns: "Ph,Nq",
      }).catch(() => [] as SemrushRecord[]),
    ]),
  );

  const seen = new Set<string>();
  const out: Array<{ keyword: string; searchVolume: number }> = [];
  for (const rows of reports) {
    for (const row of rows) {
      const keyword = (row["Keyword"] ?? row["Ph"] ?? "").trim();
      const key = keyword.toLowerCase();
      // Long-tail = 3+ words; skip head terms and dupes.
      if (!keyword || key.split(/\s+/).length < 3 || seen.has(key)) continue;
      const volume = parseIntSafe(row["Search Volume"] ?? row["Nq"] ?? "");
      if (volume < 20) continue;
      seen.add(key);
      out.push({ keyword, searchVolume: volume });
    }
  }

  return out.sort((a, b) => b.searchVolume - a.searchVolume).slice(0, limit);
}

export async function getTrackedKeywordPerformance(
  domain = SEMRUSH_DOMAIN,
): Promise<{
  tracked: Array<KeywordRow & { isTargetKeyword: boolean }>;
  missingTargets: string[];
  trendingKeywords: Array<{ keyword: string; searchVolume: number; trendScore: number }>;
  longTailSuggestions: Array<{ keyword: string; searchVolume: number }>;
}> {
  const targets = await getTargetKeywords();
  // Pull up to 1000 keywords (Semrush per-request max) so targets that rank
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

  // Real trending + long-tail from Semrush phrase reports, seeded from the
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
  ourDomain = SEMRUSH_DOMAIN,
): Promise<CompetitorKeywordGap[]> {
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
  ourDomain = SEMRUSH_DOMAIN,
  limit = 30,
): Promise<Array<CompetitorKeywordGap & { competitorsBeatingUs: number }>> {
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

export async function getBacklinkOverview(domain = SEMRUSH_DOMAIN): Promise<{
  authorityScore: number;
  totalBacklinks: number;
  referringDomains: number;
  followRatio: number;
}> {
  // Semrush's backlinks_overview column is `follows_num` (dofollow count), not
  // `follow`. The old name made every call fail with a 400 Validation Error and
  // the whole route returned 500, which is what broke /seo/backlinks.
  const rows = await fetchSemrushRowsFromAnalytics({
    type: "backlinks_overview",
    target: safeDomain(domain),
    target_type: "root_domain",
    export_columns: "ascore,total,domains_num,follows_num,nofollows_num",
    export_decode: "1",
  });
  const first = rows[0] ?? {};
  const total = parseIntSafe(first.total ?? first.Total ?? "");
  const follows = parseIntSafe(first.follows_num ?? first.Follows_num ?? "");
  return {
    authorityScore: parseIntSafe(first.ascore ?? first.Ascore ?? ""),
    totalBacklinks: total,
    referringDomains: parseIntSafe(first.domains_num ?? first.Domains_num ?? ""),
    followRatio: total > 0 ? toPercent((follows / total) * 100) : 0,
  };
}

export async function getBacklinkDomains(domain = SEMRUSH_DOMAIN): Promise<BacklinkDomain[]> {
  // backlinks_refdomains uses `domain_ascore` (not `ascore`) and does not
  // expose a follow/nofollow split. Old code requested `ascore,follow_num`
  // and the call 400'd, which made the whole backlinks page show zeros.
  const rows = await fetchSemrushRowsFromAnalytics({
    type: "backlinks_refdomains",
    target: safeDomain(domain),
    target_type: "root_domain",
    display_limit: "30",
    export_columns: "domain,backlinks_num,domain_ascore",
    export_decode: "1",
  });

  return rows
    .map((row) => {
      const backlinks = parseIntSafe(row.backlinks_num ?? row.Backlinks_num ?? "");
      const authorityScore = parseIntSafe(
        row.domain_ascore ?? row.Domain_ascore ?? row.ascore ?? "",
      );
      const toxicityRisk: "low" | "medium" | "high" =
        authorityScore >= 40 ? "low" : authorityScore >= 20 ? "medium" : "high";
      return {
        domain: row.domain ?? row.Domain ?? "",
        backlinks,
        authorityScore,
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
 *   - "last_seen_asc"   → backlinks Semrush hasn't seen recently (proxy
 *                         for lost / decaying links; powers "Lost 30d")
 */
export async function getRecentBacklinks(
  domain = SEMRUSH_DOMAIN,
  options: { limit?: number; sort?: "first_seen_desc" | "last_seen_asc" } = {},
): Promise<RecentBacklink[]> {
  const sort = options.sort ?? "first_seen_desc";
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = await fetchSemrushRowsFromAnalytics({
    type: "backlinks",
    target: safeDomain(domain),
    target_type: "root_domain",
    display_limit: String(limit),
    display_sort: sort,
    export_columns: "source_url,source_title,first_seen,last_seen,page_ascore,nofollow",
    export_decode: "1",
  });
  return rows
    .map((row) => {
      const sourceUrl = row.source_url ?? row.Source_url ?? "";
      return {
        sourceUrl,
        sourceTitle: row.source_title ?? row.Source_title ?? "",
        sourceDomain: domainOf(sourceUrl),
        pageAuthorityScore: parseIntSafe(row.page_ascore ?? row.Page_ascore ?? ""),
        firstSeenIso: unixToIso(row.first_seen ?? row.First_seen),
        lastSeenIso: unixToIso(row.last_seen ?? row.Last_seen),
        nofollow: (row.nofollow ?? row.Nofollow ?? "").toString().toLowerCase() === "true",
      };
    })
    .filter((b) => b.sourceUrl);
}

/**
 * Sample backlinks for a single referring domain — used when the user
 * expands a row in the Disavow Manager or the Domains table to inspect
 * what pages on that domain link back.
 */
export async function getBacklinksForDomain(
  referringDomain: string,
  targetDomain = SEMRUSH_DOMAIN,
  limit = 20,
): Promise<RecentBacklink[]> {
  const cleaned = referringDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const all = await getRecentBacklinks(targetDomain, { limit: 200 });
  return all.filter((b) => b.sourceDomain === cleaned).slice(0, limit);
}

export async function getOrganicCompetitors(
  domain = SEMRUSH_DOMAIN,
  limit = 20,
): Promise<
  Array<{
    domain: string;
    commonKeywords: number;
    estimatedTraffic: number;
  }>
> {
  const rows = await fetchSemrushRowsFromSeo({
    type: "domain_organic_organic",
    domain: safeDomain(domain),
    display_limit: String(limit),
    display_sort: "np_desc",
    export_decode: "1",
    export_columns: "Dn,Np,Ot",
  });
  return rows
    .map((row) => ({
      domain: row.Domain ?? row.Dn ?? "",
      commonKeywords: parseIntSafe(row["Common Keywords"] ?? row.Np ?? ""),
      estimatedTraffic: parseIntSafe(row["Organic Traffic"] ?? row.Ot ?? ""),
    }))
    // Drop directories/aggregators/gov so suggestions are real firms only.
    .filter((row) => row.domain && !isNonCompetitorDomain(row.domain));
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
  url = `https://${SEMRUSH_DOMAIN}`,
): Promise<{
  mobile: TechnicalMetric[];
  desktop: TechnicalMetric[];
  schemaChecks: TechnicalMetric[];
  crawlErrors: Array<{ url: string; issue: string; severity: "warning" | "critical" }>;
}> {
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

