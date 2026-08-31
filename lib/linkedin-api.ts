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
 * NOTHING HERE WAS TESTED AGAINST THE LIVE API
 *
 * There was no token when this was written, so the endpoint shapes come from
 * LinkedIn's documented contract rather than from a response anyone has seen.
 * That is exactly the situation that produces a client which looks right and
 * silently returns zeros, so every failure path names what actually happened —
 * the status, LinkedIn's own message, and which call it came from — and
 * scripts/check-linkedin.ts exists to make the first real response visible
 * before anything depends on it.
 *
 * VERSIONING
 *
 * The Community Management API is versioned by month and REQUIRES the header.
 * An unsupported version is rejected with a clear message, which is why the
 * value is configurable rather than compiled in: when it lapses, the fix is an
 * env var, not a deploy.
 */

/** Default API version. Override with LINKEDIN_API_VERSION when this lapses. */
const DEFAULT_VERSION = "202506";
const BASE = "https://api.linkedin.com/rest";

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

export function linkedInConfigured(): boolean {
  return Boolean(process.env.LINKEDIN_ACCESS_TOKEN?.trim());
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN?.trim() ?? ""}`,
    "LinkedIn-Version": process.env.LINKEDIN_API_VERSION?.trim() || DEFAULT_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    Accept: "application/json",
  };
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
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { headers: headers(), signal: AbortSignal.timeout(20_000) });
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

/** Total followers, which the report shows alongside the breakdowns. */
export async function fetchFollowerCount(orgUrn: string): Promise<LinkedInResult<number>> {
  const res = await get<{ firstDegreeSize?: number }>(
    `/networkSizes/${encodeURIComponent(orgUrn)}?edgeType=CompanyFollowedByMember`,
    "fetch follower count",
  );
  if (!res.ok) return res;
  const n = res.value.firstDegreeSize;
  if (typeof n !== "number") {
    return { ok: false, step: "fetch follower count", status: 200, message: "no firstDegreeSize in response" };
  }
  return { ok: true, value: n };
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
      ? "/industries?locale=(language:en,country:US)"
      : `/${kind}`;
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
