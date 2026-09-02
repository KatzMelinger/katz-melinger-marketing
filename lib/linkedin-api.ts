/**
 * LinkedIn Community Management API client.
 *
 * WHAT THIS IS FOR
 *
 * The monthly report's LinkedIn demographics — job function, seniority,
 * industry, company size, location — are typed in by hand every month. The
 * report page says so: read them off "each platform's native analytics" and
 * they "carry over month to month". LinkedIn returns exactly those five
 * breakdowns from one endpoint, so this replaces a recurring manual chore that
 * is also silently wrong whenever somebody skips a month.
 *
 * Ayrshare stays where it is. It handles posting and headline metrics well; it
 * does not expose follower demographics, which is the specific gap this fills.
 *
 * VERIFIED AGAINST THE LIVE API ON 2026-08-31
 *
 * It was written without a token, from LinkedIn's documented contract, and the
 * first real response corrected four things the docs did not: the version was
 * dead, /industries silently returns ten rows without an explicit count, the
 * follower total is served from /v2 rather than /rest, and the useful geography
 * is metro areas rather than countries. Every one of those failed quietly.
 * scripts/check-linkedin.ts is how they were found and is how the next one will
 * be.
 *
 * VERSIONING
 *
 * The Community Management API is versioned by month and REQUIRES the header.
 * An unsupported version is rejected with a clear message, which is why the
 * value is configurable rather than compiled in: when it lapses, the fix is an
 * env var, not a deploy.
 */

/**
 * Known-good API version, confirmed live on 2026-08-31.
 *
 * LinkedIn retires versions on a rolling window, so any constant here has an
 * expiry date — the first value shipped was "202506", which is June 2025 and was
 * already dead. Rather than leave a landmine that detonates in a year, a 426 is
 * recovered from: see negotiateVersion below.
 */
const DEFAULT_VERSION = "202608";
const BASE = "https://api.linkedin.com/rest";

/**
 * Versions to try when LinkedIn rejects the configured one.
 *
 * Walks back month by month from the current date — the same shape as the eCFR
 * date ladder in lib/legal-retrieval.ts, and for the same reason: an API
 * addressed by date will 4xx for a date it does not serve, and "unreachable" is
 * the wrong conclusion to draw from "not dated today".
 *
 * Deliberately NOT walked forward. A future version may exist and behave
 * differently; the point is to keep working, not to opt into an untested
 * contract on its release day.
 */
function versionLadder(from = new Date()): string[] {
  const out: string[] = [];
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth(); // 0-based
  for (let back = 0; back < 18; back++) {
    const d = new Date(Date.UTC(y, m - back, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** The version that last worked, so one negotiation serves the whole run. */
let negotiated: string | null = null;

export type LinkedInFailure = {
  ok: false;
  /** Which call failed, so a reader is not guessing. */
  step: string;
  status: number | null;
  /** LinkedIn's own message where it gave one. */
  message: string;
  /** What to do about it, when the cause is knowable from the status. */
  fix?: string;
};

export type LinkedInResult<T> = { ok: true; value: T } | LinkedInFailure;

/**
 * Can this environment talk to LinkedIn at all?
 *
 * Either a pasted access token, or the refresh-token credentials that can mint
 * one. The second is the better arrangement by a distance — see mintFromRefreshToken.
 */
export function linkedInConfigured(): boolean {
  return Boolean(process.env.LINKEDIN_ACCESS_TOKEN?.trim()) || refreshConfigured();
}

export function refreshConfigured(): boolean {
  return Boolean(
    process.env.LINKEDIN_REFRESH_TOKEN?.trim() &&
      process.env.LINKEDIN_CLIENT_ID?.trim() &&
      process.env.LINKEDIN_CLIENT_SECRET?.trim(),
  );
}

/** A minted token and when it stops being usable. */
let minted: { token: string; expiresAt: number } | null = null;

/**
 * Exchange the refresh token for a fresh access token.
 *
 * LinkedIn access tokens last 60 days; refresh tokens last 365. With a refresh
 * token the 60-day renewal stops being a calendar reminder and becomes
 * something the process does for itself — which matters because the failure it
 * replaces is silent: an expired token does not announce itself, the monthly
 * report simply keeps showing the audience it last managed to fetch.
 *
 * The minted token is kept in memory only. Vercel's filesystem is read-only at
 * runtime and an env var cannot be written back, so persisting it would mean a
 * database row holding a credential for no gain: minting costs one POST and the
 * token outlives any single job by weeks.
 */
async function mintFromRefreshToken(): Promise<string | null> {
  if (!refreshConfigured()) return null;
  // 5 minutes of headroom, so a token cannot expire between the check and the
  // call that uses it.
  if (minted && minted.expiresAt > Date.now() + 300_000) return minted.token;

  try {
    const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: process.env.LINKEDIN_REFRESH_TOKEN!.trim(),
        client_id: process.env.LINKEDIN_CLIENT_ID!.trim(),
        client_secret: process.env.LINKEDIN_CLIENT_SECRET!.trim(),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    if (!res.ok) {
      console.warn(`[linkedin] refresh-token exchange failed (${res.status}): ${body.slice(0, 200)}`);
      return null;
    }
    const j = JSON.parse(body) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };
    if (!j.access_token) return null;

    // LinkedIn returns a DIFFERENT refresh token on every exchange, and the
    // stored one keeps working regardless. Measured on 2026-09-01: two
    // consecutive exchanges of the same stored token both succeeded and each
    // handed back a distinct new refresh token, with refresh_token_expires_in
    // pinned at 365 days both times.
    //
    // So a rotation is not an event, and the warning that used to fire here was
    // a false alarm on every single run — telling someone to go and update a
    // credential that did not need updating. That is how a log line earns the
    // right to be ignored, and this file has a real warning to spend that
    // credibility on.
    //
    // Nor can refresh_token_expires_in be used for advance warning: it
    // describes the token just issued, not the one in the environment, so it
    // reads 365 days forever. The stored refresh token's own year is invisible
    // from here. When it does lapse the exchange fails, and
    // lib/linkedin-health.ts reports that as misconfigured with the reason.

    minted = {
      token: j.access_token,
      expiresAt: Date.now() + (j.expires_in ?? 5_184_000) * 1000,
    };
    return minted.token;
  } catch (e) {
    console.warn(`[linkedin] refresh-token exchange threw: ${(e as Error).message}`);
    return null;
  }
}

/**
 * The bearer token to use.
 *
 * Refresh token first when it is configured, because it is the arrangement that
 * does not rot. A pasted LINKEDIN_ACCESS_TOKEN remains a valid fallback, and is
 * what runs today.
 */
export async function currentAccessToken(): Promise<string | null> {
  const fromRefresh = await mintFromRefreshToken();
  if (fromRefresh) return fromRefresh;
  return process.env.LINKEDIN_ACCESS_TOKEN?.trim() || null;
}

function headers(version?: string, token?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token ?? process.env.LINKEDIN_ACCESS_TOKEN?.trim() ?? ""}`,
    "LinkedIn-Version":
      version ?? process.env.LINKEDIN_API_VERSION?.trim() ?? negotiated ?? DEFAULT_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    Accept: "application/json",
  };
}

/**
 * Find a version LinkedIn will accept, cheaply and once.
 *
 * Called only after a 426, so the common path costs nothing. The result is
 * remembered for the process, and reported, because a rolling window means the
 * pinned value should eventually be updated rather than rediscovered on every
 * cold start.
 */
async function negotiateVersion(path: string): Promise<string | null> {
  for (const v of versionLadder()) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: headers(v),
        signal: AbortSignal.timeout(20_000),
      });
      // 426 means only "wrong version". Anything else — including 401 and 403 —
      // means the version was accepted and the problem lies elsewhere, so stop
      // and let the caller report the real failure.
      if (res.status !== 426) {
        negotiated = v;
        console.warn(
          `[linkedin] version ${headers()["LinkedIn-Version"]} was rejected; using ${v}. ` +
            `Set LINKEDIN_API_VERSION=${v} to pin it.`,
        );
        return v;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * One GET, with the failure modes named rather than collapsed.
 *
 * A 401 and a 403 mean completely different things here — an expired token
 * versus a product that was never approved — and telling them apart is the
 * difference between "regenerate the token" and "your app cannot do this at
 * all". Returning a bare null would hide both.
 */
async function get<T>(path: string, step: string): Promise<LinkedInResult<T>> {
  if (!linkedInConfigured()) {
    return {
      ok: false, step, status: null,
      message: "LINKEDIN_ACCESS_TOKEN is not set",
      fix: "Add it to .env.local and to the Vercel project's environment variables.",
    };
  }
  const token = await currentAccessToken();
  if (!token) {
    return {
      ok: false, step, status: null,
      message: "no usable LinkedIn access token",
      fix: "Set LINKEDIN_ACCESS_TOKEN, or LINKEDIN_REFRESH_TOKEN with LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.",
    };
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: headers(undefined, token),
      signal: AbortSignal.timeout(20_000),
    });
    // A retired version is recoverable, and recovering beats telling someone to
    // go and read a changelog. Only tried when no version was pinned by hand:
    // an explicit LINKEDIN_API_VERSION is a decision, not a default to override.
    if (res.status === 426 && !process.env.LINKEDIN_API_VERSION?.trim()) {
      const v = await negotiateVersion(path);
      if (v) {
        res = await fetch(`${BASE}${path}`, {
          headers: headers(v, token),
          signal: AbortSignal.timeout(20_000),
        });
      }
    }
    // A 401 on a MINTED token means the cached one aged out mid-run. Discard it
    // and mint once more before reporting an expiry that is not real.
    if (res.status === 401 && refreshConfigured()) {
      minted = null;
      const fresh = await currentAccessToken();
      if (fresh && fresh !== token) {
        res = await fetch(`${BASE}${path}`, {
          headers: headers(undefined, fresh),
          signal: AbortSignal.timeout(20_000),
        });
      }
    }
  } catch (e) {
    return { ok: false, step, status: null, message: (e as Error).message };
  }

  const body = await res.text();
  if (!res.ok) {
    let message = body.slice(0, 400);
    try {
      const j = JSON.parse(body) as { message?: string; serviceErrorCode?: number };
      if (j.message) message = j.message;
    } catch { /* keep the raw body */ }

    const fix =
      res.status === 401
        ? "The access token is expired or invalid. LinkedIn member tokens last 60 days — regenerate it and update LINKEDIN_ACCESS_TOKEN."
        : res.status === 403
          ? "The token lacks the scope for this call. Follower statistics need r_organization_social from the Community Management API, granted for an organization you administer."
          : res.status === 426 || /version/i.test(message)
            ? `LinkedIn rejected the API version. Set LINKEDIN_API_VERSION to a currently supported YYYYMM value (currently sending ${headers()["LinkedIn-Version"]}).`
            : res.status === 429
              ? "Rate limited. LinkedIn's daily quotas are per-app; retry later rather than looping."
              : undefined;
    return { ok: false, step, status: res.status, message, fix };
  }

  try {
    return { ok: true, value: JSON.parse(body) as T };
  } catch {
    return { ok: false, step, status: res.status, message: "response was not JSON" };
  }
}

// ---------------------------------------------------------------- organizations

type AclResponse = {
  elements?: { organization?: string; role?: string; state?: string }[];
};

/**
 * Organizations this token can administer, as URNs.
 *
 * Discovered rather than configured. Asking someone to find their numeric
 * organization ID in a LinkedIn URL is a step that gets done wrong once and
 * then produces empty statistics for a page nobody owns.
 */
export async function listAdministeredOrganizations(): Promise<LinkedInResult<string[]>> {
  const res = await get<AclResponse>(
    "/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
    "list administered organizations",
  );
  if (!res.ok) return res;
  const urns = (res.value.elements ?? [])
    .map((e) => e.organization)
    .filter((u): u is string => typeof u === "string");
  return { ok: true, value: urns };
}

/** The organization to report on: the configured one, else the only one available. */
export async function resolveOrganizationUrn(): Promise<LinkedInResult<string>> {
  const configured = process.env.LINKEDIN_ORGANIZATION_ID?.trim();
  if (configured) {
    return {
      ok: true,
      value: configured.startsWith("urn:") ? configured : `urn:li:organization:${configured}`,
    };
  }
  const orgs = await listAdministeredOrganizations();
  if (!orgs.ok) return orgs;
  if (orgs.value.length === 0) {
    return {
      ok: false, step: "resolve organization", status: null,
      message: "this token administers no organizations",
      fix: "Grant the app admin access to the Katz Melinger company page, or set LINKEDIN_ORGANIZATION_ID.",
    };
  }
  if (orgs.value.length > 1) {
    return {
      ok: false, step: "resolve organization", status: null,
      message: `this token administers ${orgs.value.length} organizations: ${orgs.value.join(", ")}`,
      fix: "Set LINKEDIN_ORGANIZATION_ID to the one to report on, rather than letting it pick.",
    };
  }
  return { ok: true, value: orgs.value[0] };
}

// ---------------------------------------------------------------- follower stats

type CountEntry = { organicFollowerCount?: number; paidFollowerCount?: number };
type Bucket = Record<string, unknown> & { followerCounts?: CountEntry };

export type FollowerStatistics = {
  followerCountsByFunction?: Bucket[];
  followerCountsBySeniority?: Bucket[];
  followerCountsByIndustry?: Bucket[];
  followerCountsByStaffCountRange?: Bucket[];
  followerCountsByGeo?: Bucket[];
  followerCountsByGeoCountry?: Bucket[];
  followerCountsByRegion?: Bucket[];
  followerCountsByAssociationType?: Bucket[];
};

/** Raw follower statistics for an organization. */
export async function fetchFollowerStatistics(
  orgUrn: string,
): Promise<LinkedInResult<FollowerStatistics>> {
  const res = await get<{ elements?: FollowerStatistics[] }>(
    `/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(orgUrn)}`,
    "fetch follower statistics",
  );
  if (!res.ok) return res;
  const first = res.value.elements?.[0];
  if (!first) {
    return {
      ok: false, step: "fetch follower statistics", status: 200,
      message: "LinkedIn returned no statistics elements for this organization",
      fix: "Confirm the organization URN is the company page you administer, and that it has followers.",
    };
  }
  return { ok: true, value: first };
}

/**
 * Total followers.
 *
 * This one endpoint is served from the /v2 base, NOT /rest, and the URN must be
 * percent-encoded in the path. Every other combination answers 400 "Syntax
 * exception in path variables", which is a useless message to receive and the
 * reason this is spelled out rather than left to be rediscovered.
 *
 * The follower statistics response cannot supply this: its associationType
 * bucket counts EMPLOYEES (9 here, against 1,883 followers), and the other
 * buckets each omit followers whose attribute LinkedIn does not know, so every
 * one of them is a floor rather than a total.
 */
export async function fetchFollowerCount(orgUrn: string): Promise<LinkedInResult<number>> {
  const step = "fetch follower count";
  if (!linkedInConfigured()) {
    return { ok: false, step, status: null, message: "LINKEDIN_ACCESS_TOKEN is not set" };
  }
  const token = await currentAccessToken();
  if (!token) return { ok: false, step, status: null, message: "no usable LinkedIn access token" };
  const url =
    "https://api.linkedin.com/v2/networkSizes/" +
    encodeURIComponent(orgUrn) +
    "?edgeType=CompanyFollowedByMember";
  try {
    const res = await fetch(url, {
      headers: headers(undefined, token),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, step, status: res.status, message: body.slice(0, 200) };
    const n = (JSON.parse(body) as { firstDegreeSize?: number }).firstDegreeSize;
    if (typeof n !== "number") {
      return { ok: false, step, status: 200, message: "no firstDegreeSize in response" };
    }
    return { ok: true, value: n };
  } catch (e) {
    return { ok: false, step, status: null, message: (e as Error).message };
  }
}
// ---------------------------------------------------------------- URN labels

/**
 * Resolve the URNs in the buckets to readable names.
 *
 * LinkedIn returns "urn:li:function:1", not "Legal". Every lookup that fails
 * falls back to the raw URN rather than to a blank, because a report row
 * reading "urn:li:function:1 — 34%" is obviously broken, while a blank label is
 * a row someone might just believe.
 */
export async function fetchLabelMap(
  kind: "functions" | "seniorities" | "industries",
): Promise<LinkedInResult<Record<string, string>>> {
  const path =
    kind === "industries"
      ? // Without an explicit count this returns TEN industries and silently
        // truncates, which showed up as "urn:li:industry:43" sitting in a
        // finished report row.
        "/industries?locale=(language:en,country:US)&count=500"
      : `/${kind}?count=500`;
  const res = await get<{ elements?: { id?: number | string; name?: { localized?: Record<string, string> }; localizedName?: string }[] }>(
    path,
    `fetch ${kind}`,
  );
  if (!res.ok) return res;
  const map: Record<string, string> = {};
  for (const e of res.value.elements ?? []) {
    if (e.id === undefined) continue;
    const label =
      e.localizedName ??
      (e.name?.localized ? Object.values(e.name.localized)[0] : undefined);
    if (label) map[String(e.id)] = label;
  }
  return { ok: true, value: map };
}

/** "urn:li:function:1" -> "1" */
export function urnId(urn: string): string {
  const i = urn.lastIndexOf(":");
  return i === -1 ? urn : urn.slice(i + 1);
}

/** LinkedIn's staff-count enum is already readable once the prefix is dropped. */
export function staffCountLabel(value: string): string {
  const m = value.match(/^SIZE_(.+)$/);
  if (!m) return value;
  return m[1].replace(/_TO_/g, "-").replace(/_OR_MORE/g, "+").replace(/_/g, " ").toLowerCase();
}


/** Geo names never change, so one lookup per place per process is plenty. */
const geoMemo = new Map<string, string>();

/**
 * Resolve geo URNs to place names.
 *
 * ONE ID PER CALL, and only for ids the caller actually intends to display.
 *
 * The batch form (/geo?ids=List(a,b,c)) exists and is tempting, but it sits
 * behind its own APPLICATION DAY throttle that a single afternoon of probing
 * exhausted — after which it answers 429 while /geo/{id} keeps working. The
 * location breakdown has a hundred rows and the report shows nine of them, so
 * resolving all hundred was buying a rate-limit failure with requests whose
 * results were going to be discarded.
 *
 * `limit` is a floor under that: a caller that forgets to trim still cannot
 * spend the quota.
 */
export async function fetchGeoLabels(ids: string[], limit = 15): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const wanted = [...new Set(ids)].filter(Boolean).slice(0, limit);
  for (const id of wanted) {
    const memo = geoMemo.get(id);
    if (memo) { out[id] = memo; continue; }
    const res = await get<{ defaultLocalizedName?: { value?: string } }>(
      `/geo/${encodeURIComponent(id)}`,
      "fetch geo label",
    );
    // A lookup that fails leaves that row showing its URN — visibly broken, so
    // it gets fixed. It does not blank the row, which would get believed.
    if (!res.ok) continue;
    const name = res.value.defaultLocalizedName?.value;
    if (name) { geoMemo.set(id, name); out[id] = name; }
  }
  return out;
}
