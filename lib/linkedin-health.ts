/**
 * Is the LinkedIn token still good, and for how much longer?
 *
 * LinkedIn access tokens last 60 days. Nothing announces the expiry: calls
 * simply start returning 401, and a demographics section that silently stops
 * updating looks exactly like a page whose audience stopped changing. The
 * monthly report would keep rendering last month's numbers under this month's
 * heading — the same failure the hand-entered version had, only harder to
 * notice because it now looks automated.
 *
 * TWO MODES, AND THE ALERT SAYS WHICH ONE IT IS IN
 *
 * With LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET set, LinkedIn's
 * introspection endpoint returns the real expiry, so the warning arrives days
 * BEFORE anything breaks. Without them the only signal is a call that fails,
 * which means the warning arrives after. Both are worth having; they are not
 * worth confusing, so the status distinguishes them and the alert body says
 * plainly which one produced it.
 *
 * Introspection needs the client secret. That is a genuine secret, and the
 * degraded mode exists precisely so nobody feels obliged to put one in an
 * environment that does not need it otherwise.
 */

import { fetchFollowerStatistics, linkedInConfigured, resolveOrganizationUrn } from "./linkedin-api";

export type LinkedInHealth =
  | { state: "ok"; daysRemaining: number | null; expiresAt: string | null; detail: string }
  | { state: "expiring"; daysRemaining: number; expiresAt: string; detail: string }
  | { state: "expired"; detail: string }
  | { state: "misconfigured"; detail: string }
  | { state: "unknown"; detail: string };

/** Warn this many days before expiry. Long enough to act, short enough to mean it. */
export const WARN_WITHIN_DAYS = 14;

type Introspection = {
  active?: boolean;
  status?: string;
  expires_at?: number;
  scope?: string;
};

/**
 * Ask LinkedIn when this token dies. Null when the client credentials for
 * introspection are not configured — which is a normal state, not a fault.
 */
async function introspect(): Promise<Introspection | null> {
  const id = process.env.LINKEDIN_CLIENT_ID?.trim();
  const secret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  const token = process.env.LINKEDIN_ACCESS_TOKEN?.trim();
  if (!id || !secret || !token) return null;

  try {
    const res = await fetch("https://www.linkedin.com/oauth/v2/introspectToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, token }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Introspection;
  } catch {
    return null;
  }
}

/**
 * Check the token.
 *
 * Introspection first when available, because it can see the future. Then a
 * real API call regardless: a token can be revoked, or its page access removed,
 * without its expiry moving — introspection would still call that healthy.
 */
export async function checkLinkedInHealth(): Promise<LinkedInHealth> {
  if (!linkedInConfigured()) {
    return {
      state: "misconfigured",
      detail: "LINKEDIN_ACCESS_TOKEN is not set in this environment.",
    };
  }

  const info = await introspect();
  if (info && info.active === false) {
    return {
      state: "expired",
      detail: `LinkedIn reports the token as inactive${info.status ? ` (${info.status})` : ""}.`,
    };
  }

  // The live call. This is what actually matters: it exercises the same path
  // the report uses, so a scope or page-access problem shows up here rather
  // than on the 1st of the month.
  const org = await resolveOrganizationUrn();
  if (!org.ok) {
    if (org.status === 401) {
      return { state: "expired", detail: `LinkedIn rejected the token: ${org.message}` };
    }
    return {
      state: "unknown",
      detail: `Could not confirm the token (${org.status ?? "no response"}): ${org.message}`,
    };
  }
  const stats = await fetchFollowerStatistics(org.value);
  if (!stats.ok) {
    if (stats.status === 401) {
      return { state: "expired", detail: `LinkedIn rejected the token: ${stats.message}` };
    }
    return {
      state: "unknown",
      detail: `The token works but follower statistics failed (${stats.status ?? "no response"}): ${stats.message}`,
    };
  }

  if (info?.expires_at) {
    const expiresAt = new Date(info.expires_at * 1000);
    const days = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
    const iso = expiresAt.toISOString().slice(0, 10);
    if (days <= WARN_WITHIN_DAYS) {
      return {
        state: "expiring",
        daysRemaining: days,
        expiresAt: iso,
        detail: `The LinkedIn token expires on ${iso} — ${days} day${days === 1 ? "" : "s"} from now.`,
      };
    }
    return {
      state: "ok",
      daysRemaining: days,
      expiresAt: iso,
      detail: `Working. Expires ${iso} (${days} days).`,
    };
  }

  return {
    state: "ok",
    daysRemaining: null,
    expiresAt: null,
    detail:
      "Working. Expiry is unknown because LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are not set, " +
      "so a problem will only be reported once a call has already failed.",
  };
}

/** The steps to get a new token, kept with the alert that asks for one. */
export const RENEWAL_STEPS = [
  "Open linkedin.com/developers/apps and select KM Marketing Dashboard.",
  "Auth tab, then the 'OAuth 2.0 tools' link in the right-hand panel (or go straight to linkedin.com/developers/tools/oauth/token-generator).",
  "Tick r_organization_social and rw_organization_admin. Nothing else — no w_ scopes.",
  "Authorize, then copy the long token (300+ characters, not the Client ID or Secret).",
  "Update LINKEDIN_ACCESS_TOKEN in .env.local and in Vercel (Production, Preview and Development).",
  "Confirm with: node scripts/run.mjs scripts/check-linkedin.ts",
].join("\n");
