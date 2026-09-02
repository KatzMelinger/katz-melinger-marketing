/**
 * Meta Graph API client, for Instagram follower demographics.
 *
 * WHAT THIS IS FOR
 *
 * The other half of the monthly report's audience section. LinkedIn's is now
 * fetched; Instagram's — age, gender, cities, countries — was still typed in by
 * hand every month.
 *
 * VERIFIED AGAINST THE LIVE API ON 2026-09-01
 *
 * The route is three hops and each fails differently, so each is reported
 * separately: the token lists Pages, a Page names its linked Instagram Business
 * account, and that account serves demographics. "No data" at the end is
 * usually a missing link two hops earlier — an account that is Personal rather
 * than Business, or one not connected to the Page — and a single collapsed
 * error would send someone looking in the wrong place.
 *
 * The legacy audience_gender_age / audience_city / audience_country metrics are
 * GONE, not deprecated: v21 rejects them outright. follower_demographics with a
 * breakdown parameter replaced them. Both were tried against the live API
 * rather than trusted from documentation.
 *
 * The token is a Business Manager System User token and does not expire. That
 * was the point of choosing it: no 60-day cycle, no refresh exchange, nothing
 * to renew. It still dies if its asset assignment is removed or the system user
 * is deleted, so failure is reported rather than assumed away.
 */

/** Graph API version. Meta retires these on a roughly two-year window. */
const DEFAULT_VERSION = "v21.0";

export type MetaFailure = {
  ok: false;
  step: string;
  status: number | null;
  message: string;
  /** Meta's numeric error code, which distinguishes causes the message blurs. */
  code?: number;
  fix?: string;
};

export type MetaResult<T> = { ok: true; value: T } | MetaFailure;

export function metaConfigured(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN?.trim());
}

function version(): string {
  return process.env.META_API_VERSION?.trim() || DEFAULT_VERSION;
}

async function get<T>(
  path: string,
  params: Record<string, string>,
  step: string,
): Promise<MetaResult<T>> {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  if (!token) {
    return {
      ok: false, step, status: null,
      message: "META_ACCESS_TOKEN is not set",
      fix: "Add it to .env.local and to the Vercel project's environment variables.",
    };
  }
  const qs = new URLSearchParams({ ...params, access_token: token });
  try {
    const res = await fetch(`https://graph.facebook.com/${version()}/${path}?${qs}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok || body.error) {
      const err = (body.error ?? {}) as Record<string, unknown>;
      const code = typeof err.code === "number" ? err.code : undefined;
      const message = String(err.message ?? JSON.stringify(body).slice(0, 200));
      const fix =
        code === 190
          ? "The token is invalid or was revoked. System User tokens do not expire, so this usually means the system user lost its asset assignment or was deleted."
          : code === 10 || code === 200
            ? "The token lacks a permission for this call. Instagram demographics need instagram_basic and instagram_manage_insights."
            : code === 100 && /must be one of/.test(message)
              ? "This metric no longer exists in this API version. Meta removed the audience_* metrics in favour of follower_demographics."
              : code === 4 || code === 17 || code === 32
                ? "Rate limited. Meta's limits are per-app and per-hour; retry later rather than looping."
                : undefined;
      return { ok: false, step, status: res.status, message, code, fix };
    }
    return { ok: true, value: body as T };
  } catch (e) {
    return { ok: false, step, status: null, message: (e as Error).message };
  }
}

export type IgAccount = {
  pageId: string;
  pageName: string;
  igId: string;
  username: string;
  followers: number;
  posts: number;
};

/**
 * Find the Instagram Business account reachable from this token.
 *
 * Discovered rather than configured, for the same reason as LinkedIn's
 * organization: an id someone copied out of a URL is a step that gets done
 * wrong once and then reports zeros for an account nobody owns.
 *
 * META_IG_ACCOUNT_ID overrides, which matters if the business ever administers
 * more than one linked account.
 */
export async function resolveIgAccount(): Promise<MetaResult<IgAccount>> {
  const pages = await get<{ data?: Record<string, unknown>[] }>(
    "me/accounts",
    { fields: "id,name,instagram_business_account{id,username}" },
    "list pages",
  );
  if (!pages.ok) return pages;

  const list = pages.value.data ?? [];
  const configured = process.env.META_IG_ACCOUNT_ID?.trim();
  const match = configured
    ? list.find(
        (p) => String(((p.instagram_business_account ?? {}) as Record<string, unknown>).id) === configured,
      )
    : list.find((p) => p.instagram_business_account);

  if (!match) {
    return {
      ok: false, step: "resolve instagram account", status: null,
      message: configured
        ? `no Page links Instagram account ${configured}`
        : `none of the ${list.length} Page(s) has a linked Instagram Business account`,
      fix: "The Instagram account must be Business or Creator AND linked to the Facebook Page.",
    };
  }

  const ig = (match.instagram_business_account ?? {}) as Record<string, unknown>;
  const igId = String(ig.id);

  const acct = await get<Record<string, unknown>>(
    igId,
    { fields: "id,username,followers_count,media_count" },
    "read instagram account",
  );
  if (!acct.ok) return acct;

  return {
    ok: true,
    value: {
      pageId: String(match.id),
      pageName: String(match.name ?? ""),
      igId,
      username: String(acct.value.username ?? ig.username ?? ""),
      followers: Number(acct.value.followers_count ?? 0),
      posts: Number(acct.value.media_count ?? 0),
    },
  };
}

/** One row of a demographic breakdown, as Meta returns it. */
export type BreakdownResult = { dimension_values: string[]; value: number };

/**
 * Fetch one follower_demographics breakdown.
 *
 * `breakdown` is "age,gender", "city" or "country". Instagram requires an
 * account to have at least 100 followers before it returns any of this; below
 * that the call succeeds and the results are empty, which is why the caller
 * checks the follower count rather than reading silence as "no audience".
 */
export async function fetchFollowerDemographics(
  igId: string,
  breakdown: "age,gender" | "city" | "country",
): Promise<MetaResult<BreakdownResult[]>> {
  const res = await get<{ data?: Record<string, unknown>[] }>(
    `${igId}/insights`,
    {
      metric: "follower_demographics",
      period: "lifetime",
      timeframe: "this_month",
      metric_type: "total_value",
      breakdown,
    },
    `follower demographics (${breakdown})`,
  );
  if (!res.ok) return res;

  const block = (res.value.data ?? [])[0] as Record<string, unknown> | undefined;
  const totalValue = (block?.total_value ?? {}) as Record<string, unknown>;
  const breakdowns = (totalValue.breakdowns ?? []) as Record<string, unknown>[];
  const results = (breakdowns[0]?.results ?? []) as BreakdownResult[];
  return { ok: true, value: results };
}

/** Does this token still work, and what is it? */
export async function debugToken(): Promise<
  MetaResult<{ type: string; expiresAt: number; scopes: string[]; appId: string }>
> {
  const token = process.env.META_ACCESS_TOKEN?.trim() ?? "";
  const res = await get<{ data?: Record<string, unknown> }>(
    "debug_token",
    { input_token: token },
    "token introspection",
  );
  if (!res.ok) return res;
  const d = (res.value.data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    value: {
      type: String(d.type ?? "?"),
      // 0 means never. Kept as a number so a caller can tell "never" from "soon".
      expiresAt: Number(d.expires_at ?? 0),
      scopes: Array.isArray(d.scopes) ? (d.scopes as string[]) : [],
      appId: String(d.app_id ?? ""),
    },
  };
}
