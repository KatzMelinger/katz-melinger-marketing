import { NextResponse } from "next/server";

import type { ParsedGoogleApiError } from "@/lib/google-api-errors";
import { parseGoogleApiErrorResponse } from "@/lib/google-api-errors";
import {
  GBP_ACCOUNT_MANAGEMENT_V1_BASE,
  GBP_BUSINESS_INFO_V1_BASE,
  GBP_LOCATION_READ_MASK,
  GBP_MYBUSINESS_V4_BASE,
  GBP_OAUTH_SCOPE,
  gbpFetch,
} from "@/lib/gbp-http";
import { getGoogleAccessToken } from "@/lib/google-access-token";
import { describeServiceAccountJson } from "@/lib/google-service-account";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

type GbpLocationRow = {
  name: string;
  locationId: string;
  title: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    administrativeArea?: string;
    postalCode?: string;
  };
};

type CachedHttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  expiresAt: number;
};

// GBP dev-tier quota is 10 req/min until production access is approved.
// Bumping the positive cache to 5 min and negative to 1 min to stretch it
// — location info doesn't change minute-to-minute and we don't want every
// page view to burn quota.
const MIN_REQUEST_GAP_MS = 1000;
const DEFAULT_GET_CACHE_MS = 5 * 60_000;
const NEGATIVE_GET_CACHE_MS = 60_000;

const responseCache = new Map<string, CachedHttpResponse>();
const inFlightRequests = new Map<string, Promise<Response>>();

let throttleLock: Promise<void> = Promise.resolve();
let nextAllowedAt = 0;

function stripAccountPrefix(id: string): string {
  const t = id.trim();
  return t.startsWith("accounts/") ? t.slice("accounts/".length) : t;
}

function stripLocationPrefix(id: string): string {
  const t = id.trim();
  if (t.includes("/locations/")) {
    const after = t.split("/locations/")[1] ?? t;
    return after.split("/")[0] ?? after;
  }
  return t.startsWith("locations/") ? t.slice("locations/".length) : t;
}

function toReadableError(status: number, parsed: ParsedGoogleApiError): string {
  const detail = parsed.message?.trim() || `HTTP ${status}`;
  if (status === 404) {
    return `Location not found (404). Most common causes: (1) the saved location ID is a Google Place ID like "ChIJ…" rather than a Business Profile location ID — re-run discovery to select a valid one; (2) the location was deleted or the linked account changed. Google says: ${detail}`;
  }
  if (status === 403) {
    return `Forbidden (403). The connected account doesn't have access to this location, or the Business Information / Account Management APIs aren't enabled in the GCP project. Google says: ${detail}`;
  }
  if (status === 429) {
    return `Rate limited (429). Wait and retry. Google says: ${detail}`;
  }
  if (status === 401) {
    return `Authentication failed (401). Re-connect Google Business Profile from /integrations or verify GOOGLE_SERVICE_ACCOUNT_JSON. Google says: ${detail}`;
  }
  if (status === 400) {
    return `Bad request (400). Often means an invalid location ID format or missing readMask. Google says: ${detail}`;
  }
  return `Google API error (${status}): ${detail}`;
}

async function jsonErrorPayload(
  res: Response,
): Promise<{ friendly: string; parsed: ParsedGoogleApiError; retryAfterSeconds: number | null }> {
  const parsed = await parseGoogleApiErrorResponse(res);
  const retryAfter = res.headers.get("retry-after");
  const parsedSec = retryAfter ? Number(retryAfter) : NaN;
  const retryAfterSeconds =
    Number.isFinite(parsedSec) && parsedSec > 0
      ? Math.floor(parsedSec)
      : res.status === 429
        ? 30
        : null;
  return { friendly: toReadableError(res.status, parsed), parsed, retryAfterSeconds };
}

function formatAddress(addr: {
  addressLines?: string[];
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
} | null | undefined): string {
  if (!addr) return "";
  const lines = [...(addr.addressLines ?? [])];
  const tail = [addr.locality, addr.administrativeArea, addr.postalCode]
    .filter(Boolean)
    .join(", ");
  if (tail) lines.push(tail);
  return lines.join(", ");
}

function mapStarRating(starRating: unknown): number {
  if (typeof starRating === "number") return Math.min(5, Math.max(0, starRating));
  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
    STAR_RATING_UNSPECIFIED: 0,
  };
  return typeof starRating === "string" && starRating in map ? map[starRating] : 0;
}

function mediaKind(
  format: string | undefined,
  category: string | undefined,
): "logo" | "cover" | "interior" | "team" {
  const c = (category ?? "").toUpperCase();
  if (c.includes("LOGO") || c.includes("PROFILE")) return "logo";
  if (c.includes("COVER")) return "cover";
  if (c.includes("TEAM") || c.includes("STAFF")) return "team";
  if (format === "VIDEO") return "interior";
  return "interior";
}

function formatHoursSummary(location: {
  regularHours?: {
    periods?: Array<{
      openDay?: string;
      closeDay?: string;
      openTime?: { hours?: number; minutes?: number };
      closeTime?: { hours?: number; minutes?: number };
    }>;
  };
}): string {
  const periods = location.regularHours?.periods;
  if (!periods?.length) return "—";
  const fmt = (t: { hours?: number; minutes?: number } | undefined) => {
    if (!t) return "";
    const d = new Date();
    d.setHours(t.hours ?? 0, t.minutes ?? 0, 0, 0);
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: (t.minutes ?? 0) ? "2-digit" : undefined,
    });
  };
  return periods
    .slice(0, 14)
    .map((p) => {
      const open = fmt(p.openTime);
      const close = fmt(p.closeTime);
      const day = (p.openDay ?? "?").replace("DAY_OF_WEEK_", "");
      return open && close ? `${day}: ${open}–${close}` : day;
    })
    .join(" · ");
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function throttleBeforeGoogleCall(): Promise<void> {
  let release = () => {};
  const previous = throttleLock;
  throttleLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const now = Date.now();
    const waitFor = Math.max(0, nextAllowedAt - now);
    if (waitFor > 0) await waitMs(waitFor);
    nextAllowedAt = Date.now() + MIN_REQUEST_GAP_MS;
  } finally {
    release();
  }
}

function copyHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of res.headers.entries()) out[k] = v;
  return out;
}

function cacheTtlMs(url: string, status: number): number {
  if (status >= 400) return NEGATIVE_GET_CACHE_MS;
  if (url.includes("/accounts") || url.includes("/locations")) return 5 * 60_000;
  return DEFAULT_GET_CACHE_MS;
}

function cacheKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

function readCachedResponse(key: string): Response | null {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}

function writeCachedResponse(key: string, url: string, res: Response, body: string): void {
  responseCache.set(key, {
    status: res.status,
    statusText: res.statusText,
    headers: copyHeaders(res),
    body,
    expiresAt: Date.now() + cacheTtlMs(url, res.status),
  });
}

function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  }
  return 300 * Math.pow(2, attempt);
}

async function gbpFetchWithRetry(
  label: string,
  url: string,
  token: string,
  init?: RequestInit,
  // Retries default to 0 — at GBP's 10 req/min dev quota, retrying just
  // turns one over-quota call into three over-quota calls. We surface the
  // 429 to the UI which shows a cooldown timer; the user retries by hand.
  retries = 0,
): Promise<Response> {
  const method = init?.method ?? "GET";
  const key = cacheKey(method, url);
  if (method.toUpperCase() === "GET") {
    const cached = readCachedResponse(key);
    if (cached) return cached;
    const inFlight = inFlightRequests.get(key);
    if (inFlight) {
      const pending = await inFlight;
      return pending.clone();
    }
  }

  const run = async (): Promise<Response> => {
    await throttleBeforeGoogleCall();
    let res = await gbpFetch(label, url, token, init);
    let attempt = 0;
    while (attempt < retries && isRetryableStatus(res.status)) {
      const delay = Math.max(MIN_REQUEST_GAP_MS, retryDelayMs(res, attempt));
      await waitMs(delay);
      attempt += 1;
      await throttleBeforeGoogleCall();
      res = await gbpFetch(`${label}-retry${attempt}`, url, token, init);
    }
    const body = await res.text();
    if (method.toUpperCase() === "GET") {
      writeCachedResponse(key, url, res, body);
    }
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: copyHeaders(res),
    });
  };

  if (method.toUpperCase() !== "GET") {
    return run();
  }

  const task = run();
  inFlightRequests.set(key, task);
  try {
    const res = await task;
    return res.clone();
  } finally {
    inFlightRequests.delete(key);
  }
}

async function fetchAccounts(
  token: string,
): Promise<{ ok: true; accounts: Array<{ accountId: string; name: string }> } | {
  ok: false;
  error: string;
  googleError: ParsedGoogleApiError;
  status: number;
  retryAfterSeconds: number | null;
}> {
  const url = `${GBP_ACCOUNT_MANAGEMENT_V1_BASE}/accounts`;
  const res = await gbpFetchWithRetry("accounts-list", url, token);
  if (!res.ok) {
    const { friendly, parsed, retryAfterSeconds } = await jsonErrorPayload(res);
    return {
      ok: false,
      error: friendly,
      googleError: parsed,
      status: res.status,
      retryAfterSeconds,
    };
  }
  const json = (await res.json()) as {
    accounts?: Array<{ name?: string; accountName?: string }>;
  };
  const accounts = (json.accounts ?? [])
    .map((a) => ({
      accountId: stripAccountPrefix(String(a.name ?? "")),
      name: String(a.accountName ?? a.name ?? "Business account"),
    }))
    .filter((a) => Boolean(a.accountId));
  return { ok: true, accounts };
}

async function fetchLocations(
  token: string,
  accountId: string,
  pageToken?: string,
): Promise<{ ok: true; locations: GbpLocationRow[]; nextPageToken?: string } | {
  ok: false;
  error: string;
  googleError: ParsedGoogleApiError;
  status: number;
  retryAfterSeconds: number | null;
}> {
  const acc = encodeURIComponent(accountId);
  // v1 Business Information API requires a readMask. We request the same
  // shape we render in the UI; see GBP_LOCATION_READ_MASK in lib/gbp-http.
  const base = `${GBP_BUSINESS_INFO_V1_BASE}/accounts/${acc}/locations?pageSize=100&readMask=${encodeURIComponent(GBP_LOCATION_READ_MASK)}`;
  const url = pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base;
  const res = await gbpFetchWithRetry("locations-list", url, token);
  if (!res.ok) {
    const { friendly, parsed, retryAfterSeconds } = await jsonErrorPayload(res);
    return {
      ok: false,
      error: friendly,
      googleError: parsed,
      status: res.status,
      retryAfterSeconds,
    };
  }
  const json = (await res.json()) as {
    locations?: Array<{
      name?: string;
      title?: string;
      storefrontAddress?: GbpLocationRow["storefrontAddress"];
    }>;
    nextPageToken?: string;
  };
  const locations: GbpLocationRow[] = (json.locations ?? []).map((l) => ({
    name: String(l.name ?? ""),
    locationId: stripLocationPrefix(String(l.name ?? "")),
    title: String(l.title ?? "Location"),
    storefrontAddress: l.storefrontAddress,
  }));
  return { ok: true, locations, nextPageToken: json.nextPageToken };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const debug =
    searchParams.get("debug") === "1" || process.env.GOOGLE_DEBUG_AUTH === "1";
  const action = searchParams.get("action") ?? "dashboard";
  const pageToken = searchParams.get("pageToken")?.trim() || undefined;

  const accountId = stripAccountPrefix(
    searchParams.get("accountId")?.trim() ??
      process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim() ??
      "",
  );
  const locationId = stripLocationPrefix(
    searchParams.get("locationId")?.trim() ??
      process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim() ??
      "",
  );

  if (debug) {
    console.log(
      "[GBP] service account (safe):",
      describeServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || undefined),
    );
  }

  const auth = await getGoogleAccessToken([GBP_OAUTH_SCOPE]);
  if ("error" in auth) {
    return NextResponse.json(
      {
        error: auth.error,
        setupHints: [
          "Enable Google Business Profile APIs in Google Cloud Console.",
          "Grant service account Manager/Owner access in Business Profile settings.",
          `Ensure requested scope is ${GBP_OAUTH_SCOPE}`,
        ],
      },
      { status: 500 },
    );
  }

  if (action === "accounts") {
    const accounts = await fetchAccounts(auth.token);
    if (!accounts.ok) {
      return NextResponse.json(
        {
          error: accounts.error,
          googleError: accounts.googleError,
          rateLimited: accounts.status === 429,
          retryAfterSeconds: accounts.retryAfterSeconds,
        },
        { status: accounts.status >= 500 ? 502 : accounts.status },
      );
    }
    return NextResponse.json({ accounts: accounts.accounts });
  }

  if (!accountId) {
    return NextResponse.json(
      {
        error: "Missing Google Business account ID.",
        needsAccountSelection: true,
        setupHints: ["Select account from discovery or set GOOGLE_BUSINESS_ACCOUNT_ID."],
      },
      { status: 400 },
    );
  }

  if (action === "locations") {
    const locations = await fetchLocations(auth.token, accountId, pageToken);
    if (!locations.ok) {
      return NextResponse.json(
        {
          error: locations.error,
          googleError: locations.googleError,
          rateLimited: locations.status === 429,
          retryAfterSeconds: locations.retryAfterSeconds,
        },
        { status: locations.status >= 500 ? 502 : locations.status },
      );
    }
    return NextResponse.json({
      accountId,
      locations: locations.locations,
      nextPageToken: locations.nextPageToken ?? null,
    });
  }

  if (!locationId) {
    const discovered = await fetchLocations(auth.token, accountId);
    return NextResponse.json(
      {
        error: "No valid location selected. Use discovery to select a Business Profile location.",
        needsLocationSelection: true,
        accountId,
        locations: discovered.ok ? discovered.locations : [],
        discoveryError: discovered.ok ? null : discovered.error,
        rateLimited: !discovered.ok && discovered.status === 429,
        retryAfterSeconds: !discovered.ok ? discovered.retryAfterSeconds : null,
      },
      { status: 200 },
    );
  }

  const acc = encodeURIComponent(accountId);
  const loc = encodeURIComponent(locationId);
  // Reviews + media still live under the legacy v4 API (Google never built
  // v1 equivalents). Single-location detail moved to v1 Business Information.
  const locationNameV4 = `${GBP_MYBUSINESS_V4_BASE}/accounts/${acc}/locations/${loc}`;
  const locationNameV1 = `${GBP_BUSINESS_INFO_V1_BASE}/locations/${loc}?readMask=${encodeURIComponent(GBP_LOCATION_READ_MASK)}`;
  const locationName = locationNameV4; // backwards compat — reviews/media block uses this

  try {
    if (action === "reviews") {
      const res = await gbpFetchWithRetry(
        "get-reviews",
        `${locationName}/reviews`,
        auth.token,
      );
      if (!res.ok) {
        const { friendly, parsed, retryAfterSeconds } = await jsonErrorPayload(res);
        return NextResponse.json(
          {
            error: friendly,
            googleError: parsed,
            rateLimited: res.status === 429,
            retryAfterSeconds,
          },
          { status: res.status >= 500 ? 502 : res.status },
        );
      }
      return NextResponse.json(await res.json());
    }

    if (action === "media") {
      const res = await gbpFetchWithRetry("get-media", `${locationName}/media`, auth.token);
      if (!res.ok) {
        const { friendly, parsed, retryAfterSeconds } = await jsonErrorPayload(res);
        return NextResponse.json(
          {
            error: friendly,
            googleError: parsed,
            rateLimited: res.status === 429,
            retryAfterSeconds,
          },
          { status: res.status >= 500 ? 502 : res.status },
        );
      }
      return NextResponse.json(await res.json());
    }

    if (action === "localPosts") {
      const res = await gbpFetchWithRetry(
        "get-local-posts",
        `${locationName}/localPosts`,
        auth.token,
      );
      if (!res.ok) {
        const { friendly, parsed, retryAfterSeconds } = await jsonErrorPayload(res);
        return NextResponse.json(
          {
            error: friendly,
            googleError: parsed,
            rateLimited: res.status === 429,
            retryAfterSeconds,
          },
          { status: res.status >= 500 ? 502 : res.status },
        );
      }
      return NextResponse.json(await res.json());
    }

    if (action !== "dashboard") {
      return NextResponse.json(
        { error: `Unknown action "${action}". Use accounts, locations, reviews, media, localPosts, or dashboard.` },
        { status: 400 },
      );
    }

    // Single-location detail uses v1 Business Information; v4 was deprecated.
    const locRes = await gbpFetchWithRetry("dashboard-location", locationNameV1, auth.token);

    if (!locRes.ok) {
      const { friendly, parsed, retryAfterSeconds } = await jsonErrorPayload(locRes);
      // Don't auto-fire discovery on a 429 — that'd double the quota burn.
      // The user can click "Find locations" in the discovery panel after the
      // rate limit cools off.
      const discovered =
        locRes.status === 429
          ? { ok: true as const, locations: [] }
          : await fetchLocations(auth.token, accountId);
      return NextResponse.json(
        {
          error: friendly,
          googleError: parsed,
          needsLocationSelection: true,
          accountId,
          locationId,
          locations: discovered.ok ? discovered.locations : [],
          discoveryError: discovered.ok ? null : discovered.error,
          rateLimited: locRes.status === 429,
          retryAfterSeconds,
          ...(debug ? { googleBusinessDebug: { locationUrl: locationName } } : {}),
        },
        { status: 200 },
      );
    }

    // Dashboard initial render only fetches reviews. Media + Local Posts are
    // lazy-loaded by the individual tabs (action=media, action=localPosts) so
    // we don't burn 4 calls every time someone opens the page on dev-tier
    // GBP quota (10 req/min).
    const revRes = await gbpFetchWithRetry(
      "dashboard-reviews",
      `${locationName}/reviews?pageSize=50`,
      auth.token,
    );
    // Stub out media + posts on the initial dashboard payload — the page
    // will pull them on demand if the user clicks into those views.
    const mediaRes = new Response(JSON.stringify({ mediaItems: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const postsRes = new Response(JSON.stringify({ localPosts: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const location = (await locRes.json()) as Record<string, unknown>;
    const primary = (location.categories as { primaryCategory?: { displayName?: string } })
      ?.primaryCategory?.displayName;
    const additional =
      (location.categories as { additionalCategories?: { displayName?: string }[] })
        ?.additionalCategories?.map((c) => c.displayName).filter(Boolean) ?? [];
    const categories = [primary, ...additional].filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );

    const storefront = location.storefrontAddress as Parameters<typeof formatAddress>[0];
    const business = {
      name: String(
        (location.title as string | undefined) ||
          formatAddress(storefront) ||
          "Business",
      ),
      address: formatAddress(storefront),
      phone: String(
        (location.phoneNumbers as { primaryPhone?: string })?.primaryPhone ?? "—",
      ),
      website: String(location.websiteUri ?? "—"),
      hoursSummary: formatHoursSummary(
        location as Parameters<typeof formatHoursSummary>[0],
      ),
      categories: categories.length ? categories : ["—"],
    };

    let gbpReviews: Array<{
      id: string;
      author: string;
      rating: number;
      comment: string;
      date: string;
      responded: boolean;
    }> = [];
    if (revRes.ok) {
      const revJson = (await revRes.json()) as {
        reviews?: Array<{
          reviewId?: string;
          reviewer?: { displayName?: string };
          starRating?: unknown;
          comment?: string;
          createTime?: string;
          updateTime?: string;
          reviewReply?: { comment?: string };
        }>;
      };
      gbpReviews =
        revJson.reviews?.map((r) => ({
          id: String(r.reviewId ?? r.createTime ?? Math.random().toString(36)),
          author: String(r.reviewer?.displayName ?? "Google user"),
          rating: mapStarRating(r.starRating),
          comment: String(r.comment ?? ""),
          date: r.createTime
            ? String(r.createTime).slice(0, 10)
            : r.updateTime
              ? String(r.updateTime).slice(0, 10)
              : "",
          responded: Boolean(r.reviewReply?.comment),
        })) ?? [];
    }

    let photos: Array<{
      id: string;
      label: string;
      kind: "logo" | "cover" | "interior" | "team";
      addedAt: string;
    }> = [];
    if (mediaRes.ok) {
      const mediaJson = (await mediaRes.json()) as {
        mediaItems?: Array<{
          googleUrl?: string;
          mediaFormat?: string;
          locationAssociation?: { category?: string };
          createTime?: string;
          name?: string;
        }>;
      };
      photos =
        mediaJson.mediaItems?.map((m, i) => ({
          id: String(m.name ?? m.googleUrl ?? `media-${i}`),
          label: m.locationAssociation?.category
            ? String(m.locationAssociation.category).replace(/_/g, " ")
            : m.mediaFormat === "VIDEO"
              ? "Video"
              : "Photo",
          kind: mediaKind(m.mediaFormat, m.locationAssociation?.category),
          addedAt: m.createTime ? String(m.createTime).slice(0, 10) : "—",
        })) ?? [];
    }

    let posts: Array<{
      id: string;
      type: "announcement" | "event" | "offer";
      title: string;
      status: "scheduled" | "live" | "ended";
      startsAt: string;
    }> = [];
    if (postsRes.ok) {
      const postsJson = (await postsRes.json()) as {
        localPosts?: Array<{
          name?: string;
          summary?: string;
          topicType?: string;
          state?: string;
          createTime?: string;
          event?: { title?: string };
          searchUrl?: string;
        }>;
      };
      const mapTopic = (t: string | undefined): "announcement" | "event" | "offer" => {
        if (t === "EVENT") return "event";
        if (t === "OFFER") return "offer";
        return "announcement";
      };
      const mapState = (s: string | undefined): "scheduled" | "live" | "ended" => {
        if (s === "REJECTED" || s === "PROCESSING") return "scheduled";
        if (s === "LIVE") return "live";
        if (s === "EXPIRED" || s === "DELETED") return "ended";
        return "live";
      };
      posts =
        postsJson.localPosts?.map((p) => ({
          id: String(p.name ?? p.searchUrl ?? p.summary ?? Math.random().toString(36)),
          type: mapTopic(p.topicType),
          title: String(p.event?.title ?? p.summary?.slice(0, 120) ?? "Local post"),
          status: mapState(p.state),
          startsAt: p.createTime
            ? String(p.createTime).slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        })) ?? [];
    }

    const warnings: string[] = [];
    if (!revRes.ok) {
      const { friendly } = await jsonErrorPayload(revRes);
      warnings.push(`Reviews: ${friendly}`);
    }
    if (!mediaRes.ok) {
      const { friendly } = await jsonErrorPayload(mediaRes);
      warnings.push(`Photos: ${friendly}`);
    }
    if (!postsRes.ok) {
      const { friendly } = await jsonErrorPayload(postsRes);
      warnings.push(`Posts: ${friendly}`);
    }

    return NextResponse.json({
      business,
      gbpReviews,
      posts,
      photos,
      warnings,
      accountId,
      locationId,
      ...(debug
        ? {
            googleBusinessDebug: {
              requests: [
                { label: "location", url: locationName },
                { label: "reviews", url: `${locationName}/reviews?pageSize=50` },
                { label: "media", url: `${locationName}/media?pageSize=50` },
                { label: "localPosts", url: `${locationName}/localPosts?pageSize=50` },
              ],
            },
          }
        : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Google Business Profile request failed";
    return NextResponse.json(
      {
        error: message,
        setupHints: [
          "Confirm service-account access in Business Profile settings.",
          "Confirm account and location IDs match selected profile.",
        ],
      },
      { status: 502 },
    );
  }
}

type PostBody = {
  topicType?: "STANDARD" | "EVENT" | "OFFER";
  summary?: string;
  title?: string;
  websiteUrl?: string;
  accountId?: string;
  locationId?: string;
};

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  const auth = await getGoogleAccessToken([GBP_OAUTH_SCOPE]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 500 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const accountId = stripAccountPrefix(
    body.accountId?.trim() || process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim() || "",
  );
  const locationId = stripLocationPrefix(
    body.locationId?.trim() || process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim() || "",
  );
  if (!accountId || !locationId) {
    return NextResponse.json(
      {
        error: "Select an account and location before creating posts.",
        needsLocationSelection: true,
      },
      { status: 400 },
    );
  }

  const topic = body.topicType ?? "STANDARD";
  const summary = body.summary?.trim();
  if (!summary) {
    return NextResponse.json({ error: "summary is required" }, { status: 400 });
  }

  const parent = `${GBP_MYBUSINESS_V4_BASE}/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/localPosts`;
  const payload: Record<string, unknown> = {
    languageCode: "en",
    summary,
    topicType: topic,
  };
  if (topic === "EVENT") {
    const title = body.title?.trim() ?? summary.slice(0, 80);
    const start = new Date();
    start.setDate(start.getDate() + 1);
    payload.event = {
      title,
      schedule: {
        startDate: {
          year: start.getFullYear(),
          month: start.getMonth() + 1,
          day: start.getDate(),
        },
        startTime: { hours: 10, minutes: 0, seconds: 0, nanos: 0 },
        endDate: {
          year: start.getFullYear(),
          month: start.getMonth() + 1,
          day: start.getDate(),
        },
        endTime: { hours: 11, minutes: 0, seconds: 0, nanos: 0 },
      },
    };
  }
  if (topic === "OFFER") {
    payload.offer = {
      couponCode: "SEE_STORE",
      redeemOnlineUrl: body.websiteUrl?.trim() || "https://www.google.com",
      termsConditions: "See business for details.",
    };
  }

  const res = await gbpFetchWithRetry("create-local-post", parent, auth.token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const { friendly, parsed, retryAfterSeconds } = await jsonErrorPayload(res);
    return NextResponse.json(
      {
        error: friendly,
        googleError: parsed,
        rateLimited: res.status === 429,
        retryAfterSeconds,
      },
      { status: res.status >= 500 ? 502 : res.status },
    );
  }
  return NextResponse.json({ ok: true, localPost: await res.json() });
}
