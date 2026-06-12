/**
 * Supabase-backed cache wrapper for DataForSEO API calls.
 *
 * DataForSEO's API is POST + JSON (unlike Semrush's GET + CSV), so this exposes
 * `cachedDataForSeoPost(path, payload)` rather than a fetch() drop-in. It returns
 * the parsed JSON response. On cache hit it returns the stored JSON; on miss it
 * calls live, persists the body if the call succeeded, and returns it.
 *
 * Mirrors lib/semrush-cache.ts:
 *   - SHA-256 cache key over (path + JSON payload). Auth is a header, not part
 *     of the payload, so key rotation never invalidates the cache.
 *   - Per-endpoint TTL tuned to how fast the underlying data changes.
 *   - Errors (status_code != 20000) are NOT cached — they retry next call.
 *   - Any cache read/write failure degrades to a plain live call; caching
 *     problems must never break the user-facing flow.
 *
 * See supabase/dataforseo_cache_schema.sql for the table definition.
 */

import { createHash } from "node:crypto";

import { getSupabaseAdmin } from "./supabase-server";

const API_BASE = "https://api.dataforseo.com/v3";

/**
 * TTL in hours keyed by an endpoint fragment. The first fragment that appears
 * in the request path wins (order matters only for overlaps — none here).
 */
const TTL_HOURS: Record<string, number> = {
  // Rank-sensitive — refresh ~daily.
  ranked_keywords: 12,
  domain_rank_overview: 12,
  historical_rank_overview: 12,

  // Competitor / intersection — slower-moving.
  competitors_domain: 24,
  domain_intersection: 24,
  serp_competitors: 24,

  // Keyword volume / difficulty / ideas — essentially stable, keep a week.
  bulk_keyword_difficulty: 168,
  keyword_overview: 168,
  bulk_search_volume: 168,
  search_volume: 168,
  keyword_suggestions: 168,
  keyword_ideas: 168,
  related_keywords: 168,
  historical_keyword_data: 168,
  historical_bulk_traffic_estimation: 168,
  bulk_traffic_estimation: 168,

  // Backlinks update slowly.
  "backlinks/summary": 24,
  "backlinks/bulk_referring_domains": 24,
  "backlinks/bulk_ranks": 24,
  backlinks: 24,

  // AI-search / GEO.
  llm_mentions: 24,
  ai_keyword_data: 168,

  default: 12,
};

function reportTypeFromPath(path: string): string {
  for (const fragment of Object.keys(TTL_HOURS)) {
    if (fragment !== "default" && path.includes(fragment)) return fragment;
  }
  return "default";
}

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD?.trim();
  if (!login || !password) {
    throw new Error(
      "DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set. Add them to Vercel env vars (and .env.local for dev).",
    );
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

/** True when DataForSEO signals success at both envelope and task level. */
export function isDataForSeoOk(json: unknown): boolean {
  const j = json as { status_code?: number; tasks?: Array<{ status_code?: number }> };
  return j?.status_code === 20000 && (j?.tasks?.[0]?.status_code === 20000);
}

/**
 * POST to a DataForSEO v3 endpoint with transparent caching.
 *
 * @param path     endpoint path under /v3, e.g.
 *                 "dataforseo_labs/google/ranked_keywords/live"
 * @param payload  task object (or array of task objects). A single object is
 *                 automatically wrapped in the array DataForSEO expects.
 */
export async function cachedDataForSeoPost(
  path: string,
  payload: unknown,
): Promise<any> {
  const body = JSON.stringify(Array.isArray(payload) ? payload : [payload]);
  const reportType = reportTypeFromPath(path);
  const ttlHours = TTL_HOURS[reportType] ?? TTL_HOURS.default;
  const cacheKey = createHash("sha256").update(`${path}::${body}`).digest("hex");

  // ----- 1) Try cache --------------------------------------------------------
  try {
    const supabase = getSupabaseAdmin();
    const { data: cached } = await supabase
      .from("dataforseo_cache")
      .select("response_body, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (cached && new Date(cached.expires_at as string) > new Date()) {
      return JSON.parse(cached.response_body as string);
    }
  } catch {
    // Cache table missing / Supabase unavailable — fall through to live.
  }

  // ----- 2) Live call --------------------------------------------------------
  const res = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`DataForSEO HTTP error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  // ----- 3) Persist (best-effort, only on success) --------------------------
  if (isDataForSeoOk(json)) {
    try {
      const supabase = getSupabaseAdmin();
      const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
      await supabase.from("dataforseo_cache").upsert({
        cache_key: cacheKey,
        report_type: reportType,
        response_body: JSON.stringify(json),
        cached_at: new Date().toISOString(),
        expires_at: expiresAt,
      });
    } catch {
      // Cache write failed — caller still gets correct data.
    }
  }

  return json;
}
