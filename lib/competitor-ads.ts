/**
 * Competitor paid-ad intelligence — "Layer 0": who is running ads right now.
 *
 * For each tracked competitor domain we pull the advertiser's LIVE Google ads
 * from the Google Ads Transparency Center (via DataForSEO SERP API), then have
 * Claude synthesize what they're emphasizing and what the firm should do.
 *
 * Cost control: every lookup goes through the usage meter (lib/usage-meter.ts)
 * — quota is checked BEFORE the call and the call is recorded after. A cache hit
 * (lib/dataforseo-cache.ts is a GLOBAL cross-tenant cache) records units=0 so
 * re-pulls don't burn the tenant's monthly quota.
 *
 * Data source: DataForSEO SERP API's Google Ads Transparency endpoint
 * (serp/google/ads_search) — the live ads a given advertiser/domain is running,
 * sourced from the Google Ads Transparency Center. Same vendor/credentials as
 * the rest of our DataForSEO usage; no ad-platform API/OAuth required. The
 * fetcher is the only provider-specific code; the deferred Layer-1 paid-SERP
 * share-of-voice (serp/google/ads_advertisers) plugs in alongside it here.
 */

import {
  KEYWORD_RESEARCH_MODEL,
  cachedSystemPrompt,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";
import { cachedDataForSeoPost, isDataForSeoOk } from "@/lib/dataforseo-cache";
import { getTenantConfig } from "@/lib/tenant-config";
import { getTenantJobDb } from "@/lib/tenant-db";
import {
  Meter,
  QuotaExceededError,
  consumeUsageUnit,
  markReservationCacheHit,
  releaseUsageUnit,
} from "@/lib/usage-meter";

export const COMPETITOR_LOOKUP_METER: Meter = "competitor_lookup";
/** United States. DataForSEO location code. */
const DEFAULT_LOCATION_CODE = 2840;
/** Rough per-request cost for reporting only (DataForSEO SERP live ≈ a few cents). */
const EST_COST_CENTS_PER_SEARCH = 2;

/** Thrown when DataForSEO credentials are missing — surfaced as a friendly notice. */
export class DataForSeoNotConfiguredError extends Error {
  constructor() {
    super(
      "DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set. Add them to enable competitor ad lookups.",
    );
    this.name = "DataForSeoNotConfiguredError";
  }
}

/**
 * Thrown when DataForSEO returns HTTP 200 but a task-level error
 * (status_code != 20000). The response carries no usable items, so we must not
 * meter it as a billable lookup nor let an empty result masquerade as a genuine
 * "no ads found" signal. The route skips this competitor (transient-failure path).
 */
export class DataForSeoTaskError extends Error {
  constructor(domain: string) {
    super(`DataForSEO returned a task-level error for ${domain}.`);
    this.name = "DataForSeoTaskError";
  }
}

function dataForSeoConfigured(): boolean {
  return Boolean(
    process.env.DATAFORSEO_LOGIN?.trim() && process.env.DATAFORSEO_PASSWORD?.trim(),
  );
}
/** Don't drown the model (or the UI) in creatives. */
const MAX_ADS_PER_COMPETITOR = 25;

export interface CompetitorAd {
  format: string | null; // "text" | "image" | "video" | …
  text: string | null; // creative text when present
  advertiser: string | null; // advertiser / payer name disclosed by Google
  firstShown: string | null; // ISO date
  lastShown: string | null; // ISO date
  imageUrl: string | null;
  detailsUrl: string | null; // link into the Transparency Center
}

export interface CompetitorAdResult {
  domain: string;
  advertiserId: string | null;
  ads: CompetitorAd[];
  /** True when this advertiser had no ads in the Transparency Center. */
  noAdsFound: boolean;
}

export interface CompetitorStrategy {
  summary: string; // 2-4 sentence read on the competitive paid landscape
  competitors: {
    domain: string;
    posture: string; // what this competitor is doing in paid (offers, angles, volume)
    angles: string[]; // recurring messaging hooks observed in their creatives
  }[];
  opportunities: string[]; // gaps / openings the firm can exploit
  recommendations: {
    action: string; // concrete next step
    rationale: string; // why, tied to what the ads show
    priority: "high" | "medium" | "low";
  }[];
}

/** DataForSEO may return shown-dates as ISO strings or unix timestamps. */
function toDateISO(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v.trim());
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return new Date(n > 1e12 ? n : n * 1000).toISOString().slice(0, 10);
    return null;
  }
  if (typeof v === "number" && v > 0) {
    return new Date(v > 1e12 ? v : v * 1000).toISOString().slice(0, 10);
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Pull the items array out of a DataForSEO live/advanced response. */
function extractItems(json: any): any[] {
  const items = json?.tasks?.[0]?.result?.[0]?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * Pull a single competitor's live ads. Quota-gated and metered.
 * Throws QuotaExceededError (caller decides how to surface) or
 * DataForSeoNotConfiguredError (no credentials) before any billable work.
 *
 * Metering uses a reserve-then-settle pattern: a unit is atomically reserved
 * up front (the race-free cap), then refunded if the call turns out free (cache
 * hit → downgraded to a units=0 trace) or failed (task error → released). Only
 * a genuine live success keeps the reserved unit.
 */
export async function fetchLiveCompetitorAds(input: {
  tenantId: string;
  competitorDomain: string;
  locationCode?: number;
}): Promise<CompetitorAdResult> {
  const domain = input.competitorDomain.trim().toLowerCase();
  if (!dataForSeoConfigured()) throw new DataForSeoNotConfiguredError();

  // Atomically reserve a billable unit BEFORE the call. This is the hard cap:
  // concurrent callers serialize on the limit row, so they can't both overshoot.
  const reservation = await consumeUsageUnit({
    tenantId: input.tenantId,
    meter: COMPETITOR_LOOKUP_METER,
    provider: "dataforseo",
    endpoint: "serp/google/ads_search",
    estCostCents: EST_COST_CENTS_PER_SEARCH,
    detail: domain,
  });
  if (!reservation.allowed) {
    throw new QuotaExceededError(COMPETITOR_LOOKUP_METER, reservation.used, reservation.cap);
  }

  let json: unknown;
  try {
    json = await cachedDataForSeoPost("serp/google/ads_search/live/advanced", {
      target: domain,
      location_code: input.locationCode ?? DEFAULT_LOCATION_CODE,
      language_code: "en",
      platform: "all",
    });
  } catch (err) {
    // Transient/HTTP failure — nothing billable happened; refund and rethrow
    // (the route skips this competitor).
    await releaseUsageUnit(reservation.usageId);
    throw err;
  }

  const cacheHit = Boolean((json as { __cacheHit?: boolean }).__cacheHit);
  if (cacheHit) {
    // Served from the shared cache: free. Keep a units=0 trace, don't bill.
    await markReservationCacheHit(reservation.usageId);
  } else if (!isDataForSeoOk(json)) {
    // Task-level error (HTTP 200, status_code != 20000): DataForSEO doesn't bill
    // it, and the empty result must not read as a real "no ads found". Refund
    // and throw so the route skips this competitor.
    await releaseUsageUnit(reservation.usageId);
    throw new DataForSeoTaskError(domain);
  }
  // Genuine live success keeps the reserved unit as-is.

  const items = extractItems(json);
  const ads: CompetitorAd[] = items.slice(0, MAX_ADS_PER_COMPETITOR).map((c) => ({
    format: asString(c?.format),
    // ads_search lists creatives; text fields vary by ad type — fall back to null.
    text: asString(c?.text) ?? asString(c?.content) ?? asString(c?.description) ?? null,
    // `title` is the advertiser/payer name disclosed by the Transparency Center.
    advertiser: asString(c?.title) ?? asString(c?.advertiser),
    firstShown: toDateISO(c?.first_shown),
    lastShown: toDateISO(c?.last_shown),
    imageUrl: asString(c?.preview_image?.url) ?? asString(c?.image),
    detailsUrl: asString(c?.url) ?? asString(c?.details_link),
  }));

  const advertiserId = asString(items[0]?.advertiser_id);

  return { domain, advertiserId, ads, noAdsFound: ads.length === 0 };
}

const STRATEGY_SYSTEM_PROMPT = `You are a senior paid-search strategist for a law firm. You are given, for each competitor, the LIVE ads they are currently running according to the Google Ads Transparency Center (public data). Your job is to read the competitive paid landscape and tell the firm what to do.

Be concrete and tie every observation to what the ads actually show — the offers, hooks, formats, and how recently/heavily each competitor is advertising. Do NOT invent spend figures: the Transparency Center does not disclose budget for commercial ads, so speak in relative terms ("running many text ads", "consistently active", "appears to have paused") rather than dollar amounts. If a competitor has no ads, say so — that is itself a signal.

Return ONLY a JSON object with this exact shape — no preamble, no markdown fences:
{
  "summary": "2-4 sentence read on the competitive paid landscape and the single most important takeaway",
  "competitors": [
    { "domain": "...", "posture": "what they're doing in paid right now", "angles": ["recurring messaging hook", "..."] }
  ],
  "opportunities": ["gap or opening the firm can exploit, grounded in what competitors are/aren't doing"],
  "recommendations": [
    { "action": "concrete next step", "rationale": "why, tied to the ad evidence", "priority": "high|medium|low" }
  ]
}

Order recommendations most-impactful first.`;

/** Have Claude synthesize "what they're doing / what we should do" from the pulled ads. */
export async function synthesizeCompetitorStrategy(
  results: CompetitorAdResult[],
  tenantId: string,
): Promise<CompetitorStrategy> {
  const cfg = await getTenantConfig(tenantId);

  const evidence = results
    .map((r) => {
      if (r.noAdsFound) return `## ${r.domain}\n(No live ads found in the Transparency Center.)`;
      const lines = r.ads
        .map(
          (a) =>
            `- [${a.format ?? "ad"}] ${a.text ?? "(no text captured)"}` +
            `${a.advertiser ? ` — advertiser/payer: ${a.advertiser}` : ""}` +
            `${a.firstShown || a.lastShown ? ` (shown ${a.firstShown ?? "?"}→${a.lastShown ?? "?"})` : ""}`,
        )
        .join("\n");
      return `## ${r.domain} — ${r.ads.length} live ad(s)\n${lines}`;
    })
    .join("\n\n");

  const userPrompt = `Firm: ${cfg.firmName}
Target geography: ${cfg.targetGeography}

Competitor live-ad evidence from the Google Ads Transparency Center:

${evidence}

Analyze the competitive paid landscape and return ONLY the JSON object.`;

  const response = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 4096,
    system: cachedSystemPrompt(STRATEGY_SYSTEM_PROMPT),
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  let result: CompetitorStrategy;
  try {
    result = extractJSON<CompetitorStrategy>(text);
  } catch (err) {
    // Malformed model output shouldn't 500 the whole scan — return an empty but
    // valid strategy so the UI still renders the pulled ads.
    console.warn("[competitor-ads] strategy JSON parse failed:", err);
    result = { summary: "", competitors: [], opportunities: [], recommendations: [] };
  }

  // Defensive normalization — the UI relies on these always being arrays.
  result.competitors = Array.isArray(result.competitors) ? result.competitors : [];
  result.opportunities = Array.isArray(result.opportunities) ? result.opportunities : [];
  result.recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
  return result;
}

/** Best-effort: store a snapshot of this scan for history/diffing. Never throws. */
export async function recordCompetitorSnapshot(
  tenantId: string,
  result: CompetitorAdResult,
): Promise<void> {
  try {
    const db = getTenantJobDb(tenantId);
    await db.insert("competitor_ad_snapshots", {
      competitor_domain: result.domain,
      advertiser_id: result.advertiserId,
      ad_count: result.ads.length,
      snapshot: result.ads,
    });
  } catch (err) {
    console.warn("[competitor-ads] snapshot persistence failed:", err);
  }
}

export { QuotaExceededError };
