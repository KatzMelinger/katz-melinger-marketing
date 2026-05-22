/**
 * Supabase-backed cache wrapper around `fetch()` for Semrush API calls.
 *
 * The cache layer is transparent: callers swap `fetch(url, opts)` for
 * `cachedSemrushFetch(url, opts)` and get back a Response-shaped object.
 * Each report type has its own TTL chosen to match how often that data
 * actually changes on Semrush's side — rankings refresh weekly, keyword
 * difficulty barely moves, backlinks are even slower.
 *
 * Why a custom cache:
 *   - Next.js's built-in fetch cache is per-deployment and tied to
 *     `revalidate` headers, so it doesn't survive across hot reloads, isn't
 *     visible across multiple Vercel functions, and can't be tuned per
 *     report type.
 *   - We need persistent caching across all Vercel cold starts.
 *   - Supabase is already a hard dependency, no extra infra.
 *
 * What's NOT cached:
 *   - ERROR responses from Semrush ("API UNITS BALANCE IS ZERO", "NOTHING
 *     FOUND", etc.). Those should retry on the next call so the user sees
 *     fresh data as soon as units replenish or the upstream data populates.
 *   - Non-200 HTTP responses. Same reason.
 *
 * See supabase/semrush_cache_schema.sql for the table definition.
 */

import { createHash } from "node:crypto";

import { getSupabaseAdmin } from "./supabase-server";

/**
 * TTL in hours per Semrush report type (the `type` query param). Tuned to
 * the underlying data's refresh rate on Semrush's side — anything shorter
 * is wasted units, anything longer risks showing stale rankings.
 */
const TTL_HOURS: Record<string, number> = {
  // Rank-sensitive reports — refresh roughly daily, Semrush ranks update
  // ~weekly so 12h is a reasonable middle ground.
  domain_organic: 12,
  domain_organic_organic: 24,
  domain_ranks: 12,
  domain_ranks_history: 24,
  domain_adwords: 24,

  // Keyword volume / difficulty barely changes — keep for a week.
  phrase_kdi: 168,
  phrase_these: 168,
  phrase_this: 168,
  phrase_related: 168,
  phrase_questions: 168,
  phrase_fullsearch: 168,

  // Backlinks update slowly on Semrush — daily TTL is generous.
  backlinks: 24,
  backlinks_overview: 24,
  backlinks_refdomains: 24,
  backlinks_anchors: 24,
  backlinks_pages: 24,

  // Anything we haven't enumerated — fall back to 12h.
  default: 12,
};

function getTtlHours(reportType: string): number {
  return TTL_HOURS[reportType] ?? TTL_HOURS.default;
}

/**
 * Build a stable cache key from a Semrush URL. The `key` (API key) param is
 * stripped before hashing so rotating the API key doesn't invalidate the
 * entire cache.
 */
function cacheKeyForUrl(url: string): { cacheKey: string; reportType: string } {
  const u = new URL(url);
  u.searchParams.delete("key");
  // Stable param order for deterministic hashing.
  u.searchParams.sort();
  const reportType =
    u.searchParams.get("type") ??
    // Analytics endpoints use the report name in the path segment
    // (e.g. /analytics/v1/?type=backlinks_overview).
    u.searchParams.get("report") ??
    "default";
  const cacheKey = createHash("sha256").update(u.toString()).digest("hex");
  return { cacheKey, reportType };
}

type FetchInit = Parameters<typeof fetch>[1];

/**
 * Drop-in `fetch()` replacement for Semrush API calls. On cache hit, the
 * returned Response is constructed from the stored body and `.ok` is true.
 * On miss, it fetches live, persists the body if it's a non-error 200,
 * and returns the live Response.
 *
 * The function is intentionally forgiving: any error reading or writing the
 * cache table degrades to a normal live fetch. We never want caching
 * problems to break the user-facing flow — they just produce log noise.
 */
export async function cachedSemrushFetch(
  url: string,
  init?: FetchInit,
): Promise<Response> {
  const { cacheKey, reportType } = cacheKeyForUrl(url);
  const ttlHours = getTtlHours(reportType);

  // ----- 1) Try cache --------------------------------------------------------
  try {
    const supabase = getSupabaseAdmin();
    const { data: cached } = await supabase
      .from("semrush_cache")
      .select("response_body, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (cached && new Date(cached.expires_at as string) > new Date()) {
      return new Response(cached.response_body as string, { status: 200 });
    }
  } catch {
    // Cache table missing / Supabase unavailable — fall through to live.
  }

  // ----- 2) Live fetch -------------------------------------------------------
  // 30s timeout matches what semrush.ts uses elsewhere — Semrush is usually
  // fast but occasionally stalls on backlinks reports.
  const liveInit: FetchInit = {
    method: "GET",
    signal: AbortSignal.timeout(30_000),
    ...init,
  };
  const live = await fetch(url, liveInit);

  // Read the body up front so we can both inspect it (to skip caching
  // errors) and return it. Response bodies can only be consumed once, so
  // we rebuild a fresh Response below for the caller.
  if (!live.ok) {
    // Don't cache non-200s; return the live response so the caller's
    // existing error path runs. The body's still readable because we
    // haven't consumed it.
    return live;
  }
  const body = await live.text();

  // ----- 3) Persist (best-effort) -------------------------------------------
  // Semrush signals errors in the body with an "ERROR " prefix even on a
  // 200 status. Don't cache those — they should retry next call.
  const isSemrushError = body.startsWith("ERROR");
  if (!isSemrushError) {
    try {
      const supabase = getSupabaseAdmin();
      const expiresAt = new Date(
        Date.now() + ttlHours * 3600 * 1000,
      ).toISOString();
      await supabase.from("semrush_cache").upsert({
        cache_key: cacheKey,
        report_type: reportType,
        response_body: body,
        cached_at: new Date().toISOString(),
        expires_at: expiresAt,
      });
    } catch {
      // Cache write failed — caller still gets correct data, we just don't
      // benefit from the cache next time.
    }
  }

  return new Response(body, { status: 200 });
}
