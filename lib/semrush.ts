/**
 * Semrush helper for MarketOS.
 *
 * Two layers:
 *
 *   1. Original low-level utilities used by the SEO Overview API routes
 *      (semrushSeoUrl, semrushAnalyticsUrl, parseSemrushCsv, rowToRecord,
 *      parseIntSafe, SEMRUSH_DOMAIN, SEMRUSH_DATABASE).
 *
 *   2. Higher-level helpers added for the Keyword Research feature
 *      (getDomainKeywords, getKeywordDifficulty, lookupKeywordRanking,
 *      SemrushKeywordRow type).
 *
 * The two layers don't interfere — the second layer is built on a separate,
 * stricter CSV parser because it expects header-keyed objects, while the
 * original parseSemrushCsv returns parallel arrays for the older callers.
 */

// ============================================================================
// Layer 1 — original exports (DO NOT REMOVE — used by /api/seo/* routes)
// ============================================================================

export const SEMRUSH_DOMAIN = "katzmelinger.com";
export const SEMRUSH_DATABASE = "us";

import { cachedSemrushFetch } from "./semrush-cache";

const SEO_BASE = "https://api.semrush.com/";
const ANALYTICS_BASE = "https://api.semrush.com/analytics/v1/";

export function semrushSeoUrl(params: Record<string, string>): string {
  const u = new URL(SEO_BASE);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

export function semrushAnalyticsUrl(params: Record<string, string>): string {
  const u = new URL(ANALYTICS_BASE);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

/** Semrush returns semicolon-separated CSV; first line is headers. */
export function parseSemrushCsv(text: string): {
  headers: string[];
  rows: string[][];
} | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("ERROR")) {
    return null;
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length < 1) {
    return null;
  }
  const headers = lines[0]!.split(";").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(";").map((c) => c.trim()));
  return { headers, rows };
}

export function rowToRecord(
  headers: string[],
  row: string[],
): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => {
    o[h] = row[i] ?? "";
  });
  return o;
}

export function parseIntSafe(v: string | undefined): number {
  if (v == null || v === "") {
    return 0;
  }
  const n = Number.parseInt(v.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// ============================================================================
// Layer 2 — keyword research helpers (added April 2026)
// ============================================================================

export type SemrushKeywordRow = {
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

function getApiKey(): string {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) {
    throw new Error(
      "SEMRUSH_API_KEY is not set. Add it to Vercel env vars (and .env.local for dev).",
    );
  }
  return key;
}

/**
 * Strict CSV parser for layer 2. Returns header-keyed objects rather than the
 * parallel-arrays shape used by the original parseSemrushCsv.
 */
function parseSemrushCsvObjects(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(";");
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function toNum(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapSort(
  sortBy: string | undefined,
  sortDir: "asc" | "desc" | undefined,
): string {
  const dir = sortDir === "asc" ? "asc" : "desc";
  const map: Record<string, string> = {
    traffic: `tr_${dir}`,
    position: `po_${dir}`,
    volume: `nq_${dir}`,
    cpc: `cp_${dir}`,
    competition: `co_${dir}`,
  };
  return map[sortBy ?? "traffic"] ?? `tr_${dir}`;
}

/**
 * Pulls the domain_organic report from Semrush — keywords the domain
 * currently ranks for in Google's top 100 organic results.
 */
export async function getDomainKeywords(
  domain: string | undefined,
  database: string | undefined,
  limit: number = 200,
  offset: number = 0,
  sortBy: string = "traffic",
  sortDir: "asc" | "desc" = "desc",
): Promise<SemrushKeywordRow[]> {
  const key = getApiKey();
  const params = new URLSearchParams({
    type: "domain_organic",
    key,
    domain: domain ?? SEMRUSH_DOMAIN,
    database: database ?? SEMRUSH_DATABASE,
    display_limit: String(Math.min(Math.max(limit, 1), 1000)),
    display_offset: String(Math.max(offset, 0)),
    display_sort: mapSort(sortBy, sortDir),
    export_columns: "Ph,Po,Pp,Pd,Nq,Cp,Ur,Tr,Tc,Co,Nr,Td",
  });

  const res = await cachedSemrushFetch(`${SEO_BASE}?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`Semrush API error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();

  if (text.startsWith("ERROR")) {
    if (/NOTHING\s*FOUND/i.test(text) || /50 ::/.test(text)) return [];
    throw new Error(`Semrush returned: ${text.trim()}`);
  }

  const rows = parseSemrushCsvObjects(text);
  return rows.map((r) => ({
    keyword: r["Keyword"] ?? "",
    position: toNum(r["Position"]),
    previousPosition: toNum(r["Previous Position"]),
    positionDifference: toNum(r["Position Difference"]),
    volume: toNum(r["Search Volume"]),
    cpc: toNum(r["CPC"]),
    url: r["Url"] || null,
    trafficPercent: toNum(r["Traffic (%)"]),
    competition: toNum(r["Competition"]),
    numberOfResults: toNum(r["Number of Results"]),
    difficulty: null,
  }));
}

/**
 * Look up keyword difficulty for one or more phrases via the phrase_kdi
 * endpoint. Returns a map of lowercase keyword -> difficulty (0-100).
 */
export async function getKeywordDifficulty(
  phrases: string[],
  database: string = SEMRUSH_DATABASE,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (phrases.length === 0) return out;

  const key = getApiKey();

  const chunks: string[][] = [];
  for (let i = 0; i < phrases.length; i += 100) {
    chunks.push(phrases.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const params = new URLSearchParams({
      type: "phrase_kdi",
      key,
      phrase: chunk.join(";"),
      database,
      export_columns: "Ph,Kd",
    });

    try {
      const res = await cachedSemrushFetch(`${SEO_BASE}?${params.toString()}`);
      if (!res.ok) continue;

      const text = await res.text();
      if (text.startsWith("ERROR")) continue;

      const rows = parseSemrushCsvObjects(text);
      for (const r of rows) {
        const phrase = r["Keyword"]?.toLowerCase().trim();
        const kd = toNum(r["Keyword Difficulty Index"]);
        if (phrase && kd !== null) out.set(phrase, kd);
      }
    } catch {
      // skip this chunk, keep going
    }
  }

  return out;
}

/**
 * Look up search volume / CPC / competition for one or more phrases via the
 * phrase_these endpoint. Use this for keywords the firm doesn't rank for —
 * domain_organic only returns ranked keywords. Returns a map of lowercase
 * keyword -> metrics.
 */
export async function getPhraseMetrics(
  phrases: string[],
  database: string = SEMRUSH_DATABASE,
): Promise<Map<string, { volume: number; cpc: number; competition: number }>> {
  const out = new Map<string, { volume: number; cpc: number; competition: number }>();
  if (phrases.length === 0) return out;

  const key = getApiKey();

  // phrase_these caps at 100 phrases per request.
  const chunks: string[][] = [];
  for (let i = 0; i < phrases.length; i += 100) {
    chunks.push(phrases.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const params = new URLSearchParams({
      type: "phrase_these",
      key,
      phrase: chunk.join(";"),
      database,
      export_columns: "Ph,Nq,Cp,Co",
    });

    try {
      const res = await cachedSemrushFetch(`${SEO_BASE}?${params.toString()}`);
      if (!res.ok) continue;

      const text = await res.text();
      if (text.startsWith("ERROR")) continue;

      const rows = parseSemrushCsvObjects(text);
      for (const r of rows) {
        const phrase = r["Keyword"]?.toLowerCase().trim();
        const volume = parseIntSafe(r["Search Volume"]);
        const cpc = toNum(r["CPC"]) ?? 0;
        const competition = toNum(r["Competition"]) ?? 0;
        if (phrase) out.set(phrase, { volume, cpc, competition });
      }
    } catch {
      // skip this chunk, keep going
    }
  }

  return out;
}

/**
 * Real 12-month search-interest trend for a keyword, from Semrush's `phrase_this`
 * report (the `Td` / Trends column). Returns the monthly values, search volume,
 * and a derived direction. This is the legitimate replacement for the
 * LLM-"trends" guesser — use it to validate whether demand is rising or fading.
 *
 * Td is a comma-separated list of ~12 relative values (0–1), oldest first. We
 * compare the most-recent quarter against the earliest to classify direction.
 */
export async function getKeywordTrend(
  keyword: string,
  database: string = SEMRUSH_DATABASE,
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
    const key = getApiKey();
    const params = new URLSearchParams({
      type: "phrase_this",
      key,
      phrase: keyword,
      database,
      export_columns: "Ph,Nq,Td",
    });
    const res = await cachedSemrushFetch(`${SEO_BASE}?${params.toString()}`);
    if (!res.ok) return empty;
    const text = await res.text();
    if (text.startsWith("ERROR")) return empty;

    const rows = parseSemrushCsvObjects(text);
    const r = rows[0];
    if (!r) return empty;

    const searchVolume = toNum(r["Search Volume"]);
    const trend = (r["Trends"] ?? "")
      .split(",")
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));

    let direction: "rising" | "stable" | "falling" | "unknown" = "unknown";
    if (trend.length >= 4) {
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const diff = avg(trend.slice(-3)) - avg(trend.slice(0, 3));
      direction = diff > 0.1 ? "rising" : diff < -0.1 ? "falling" : "stable";
    }
    return { keyword, searchVolume, trend, direction };
  } catch {
    return empty;
  }
}

/**
 * Convenience: look up a single keyword on the firm's domain. Used by the
 * "add tracked keyword" flow to populate initial position/volume/difficulty.
 */
export async function lookupKeywordRanking(
  keyword: string,
  domain: string = SEMRUSH_DOMAIN,
): Promise<{
  currentRank: number | null;
  searchVolume: number | null;
  difficulty: number | null;
  url: string | null;
}> {
  const normalized = keyword.toLowerCase().trim();

  try {
    const all = await getDomainKeywords(domain, undefined, 500, 0, "traffic", "desc");

    const exact = all.find((kw) => kw.keyword.toLowerCase().trim() === normalized);
    const partial =
      exact ??
      all.find(
        (kw) =>
          kw.keyword.toLowerCase().includes(normalized) ||
          normalized.includes(kw.keyword.toLowerCase()),
      );

    if (!partial) {
      // Firm doesn't rank for this keyword — but we still want its volume
      // and difficulty for the tracker UI. Hit phrase_these + phrase_kdi.
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