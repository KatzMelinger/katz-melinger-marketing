/**
 * Connection health + keep-alive registry — one place that knows how to check
 * and refresh every OAuth connection the app maintains, so a single cron and a
 * single health endpoint cover them all.
 *
 * Today that's:
 *   - Constant Contact (oauth_tokens, provider=constant_contact) — ROTATING
 *     refresh token, so it's the fragile one: it must be requested with the
 *     offline_access scope, and left idle it can lapse. Keep-alive refreshes it
 *     before expiry from one place (the prod cron) so it stays warm.
 *   - Google Business Profile (google_oauth_tokens, purpose=gbp) — non-rotating
 *     refresh token; getValidAccessToken refreshes on demand. Keep-alive just
 *     warms it.
 *
 * Tenant scope: the CC helpers resolve the tenant from context (default tenant
 * in a cron with no session). Single-tenant today; loop tenants here when the
 * platform goes multi-tenant.
 */

import {
  getLatestConstantContactTokens,
  refreshAccessTokenIfPossible,
} from "@/lib/constant-contact-server";
import { getStoredToken, getValidAccessToken } from "@/lib/google-oauth";

export type ConnectionStatus = "ok" | "expiring" | "at_risk" | "disconnected";

export type ConnectionHealth = {
  id: string;
  label: string;
  connected: boolean;
  hasRefreshToken: boolean;
  expiresAt: string | null;
  expiresInMinutes: number | null;
  status: ConnectionStatus;
  detail: string;
};

export type KeepAliveResult = {
  id: string;
  refreshed: boolean;
  skipped: boolean;
  error?: string;
};

/** Refresh when the access token expires within this window (minutes). Keeps
 *  rotation churn low — we don't refresh a token that's still good for hours. */
const REFRESH_WITHIN_MIN = 6 * 60;

function minutesUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

function buildHealth(
  id: string,
  label: string,
  connected: boolean,
  hasRefreshToken: boolean,
  expiresAt: string | null,
): ConnectionHealth {
  const mins = minutesUntil(expiresAt);
  let status: ConnectionStatus;
  let detail: string;
  if (!connected) {
    status = "disconnected";
    detail = "Not connected.";
  } else if (!hasRefreshToken) {
    status = "at_risk";
    detail =
      "No refresh token — the connection will require a manual reconnect when the access token expires. Reconnect once to fix (the app now requests offline access).";
  } else if (mins != null && mins <= 0) {
    status = "expiring";
    detail = "Access token expired — it will refresh on next use or keep-alive.";
  } else if (mins != null && mins <= 60) {
    status = "expiring";
    detail = `Access token expires in ${mins} min; auto-refresh is pending.`;
  } else {
    status = "ok";
    detail =
      mins != null ? `Healthy — token valid for ~${Math.round(mins / 60)}h.` : "Healthy.";
  }
  return { id, label, connected, hasRefreshToken, expiresAt, expiresInMinutes: mins, status, detail };
}

async function constantContactHealth(): Promise<ConnectionHealth> {
  let connected = false;
  let hasRefresh = false;
  let expiresAt: string | null = null;
  try {
    const t = await getLatestConstantContactTokens();
    if (!("error" in t)) {
      connected = !!t.accessToken;
      hasRefresh = !!t.refreshToken;
      expiresAt = t.expiresAt;
    }
  } catch {
    /* treated as disconnected */
  }
  return buildHealth("constant_contact", "Constant Contact", connected, hasRefresh, expiresAt);
}

async function googleGbpHealth(): Promise<ConnectionHealth> {
  let connected = false;
  let hasRefresh = false;
  let expiresAt: string | null = null;
  try {
    const t = await getStoredToken("gbp");
    if (t) {
      connected = !!t.access_token;
      hasRefresh = !!t.refresh_token;
      expiresAt = t.expires_at;
    }
  } catch {
    /* treated as disconnected */
  }
  return buildHealth("google_gbp", "Google Business Profile", connected, hasRefresh, expiresAt);
}

/** Health for every connection, for the health endpoint + badge. */
export async function getConnectionsHealth(): Promise<ConnectionHealth[]> {
  return Promise.all([constantContactHealth(), googleGbpHealth()]);
}

/** Refresh connections that are near expiry, so they never lapse from idleness.
 *  Skips ones still valid for a while (minimises rotation). */
export async function keepAliveConnections(): Promise<KeepAliveResult[]> {
  const results: KeepAliveResult[] = [];

  // Constant Contact — only refresh when near expiry (its refresh rotates).
  try {
    const t = await getLatestConstantContactTokens();
    if ("error" in t) {
      results.push({ id: "constant_contact", refreshed: false, skipped: true, error: t.error });
    } else if (!t.refreshToken) {
      results.push({
        id: "constant_contact",
        refreshed: false,
        skipped: true,
        error: "No refresh token — reconnect once (offline_access is now requested).",
      });
    } else {
      const mins = minutesUntil(t.expiresAt);
      if (mins == null || mins <= REFRESH_WITHIN_MIN) {
        const r = await refreshAccessTokenIfPossible();
        results.push({
          id: "constant_contact",
          refreshed: r.ok,
          skipped: false,
          error: r.ok ? undefined : r.error,
        });
      } else {
        results.push({ id: "constant_contact", refreshed: false, skipped: true });
      }
    }
  } catch (e) {
    results.push({
      id: "constant_contact",
      refreshed: false,
      skipped: false,
      error: e instanceof Error ? e.message : "keep-alive failed",
    });
  }

  // Google GBP — getValidAccessToken is a no-op unless near expiry, so it's
  // safe to call every run and won't churn the (non-rotating) refresh token.
  try {
    const stored = await getStoredToken("gbp");
    if (!stored?.refresh_token) {
      results.push({ id: "google_gbp", refreshed: false, skipped: true, error: "Not connected." });
    } else {
      const v = await getValidAccessToken("gbp");
      results.push({
        id: "google_gbp",
        refreshed: !!v,
        skipped: false,
        error: v ? undefined : "Refresh failed — reconnect required.",
      });
    }
  } catch (e) {
    results.push({
      id: "google_gbp",
      refreshed: false,
      skipped: false,
      error: e instanceof Error ? e.message : "keep-alive failed",
    });
  }

  return results;
}
