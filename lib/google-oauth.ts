/**
 * Google OAuth 2.0 (user consent) helpers.
 *
 * Used for APIs that require user authorization rather than a service account
 * — primarily Google Business Profile. The flow:
 *
 *   1. User clicks "Connect GBP" → redirected to /api/google/oauth/start
 *   2. We send them to Google's consent screen with the right scopes
 *   3. They click Allow → Google redirects to /api/google/oauth/callback
 *   4. We exchange the code for { access_token, refresh_token, expires_in }
 *   5. We store everything in google_oauth_tokens (purpose='gbp')
 *   6. Future GBP API calls call getStoredAccessToken('gbp'), which auto-
 *      refreshes when the access token is near expiry.
 *
 * Env vars required:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   (redirect URI is computed from the request origin so we can support
 *    preview/prod/dev without re-registering it for each.)
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";

export type Purpose = "gbp";

export const PURPOSE_SCOPES: Record<Purpose, string[]> = {
  // 'openid' and 'email' let us fetch the granting user's email so the
  // /integrations page can show "Connected as foo@bar.com" instead of
  // "(unknown)". Doesn't grant access to anything beyond identity.
  gbp: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/business.manage",
  ],
};

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

function getClientId(): string {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!id) throw new Error("GOOGLE_OAUTH_CLIENT_ID env var not set");
  return id;
}

function getClientSecret(): string {
  const s = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!s) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET env var not set");
  return s;
}

export function buildRedirectUri(origin: string): string {
  // Strip trailing slash to produce a stable redirect URI we can pre-register.
  const base = origin.replace(/\/$/, "");
  return `${base}/api/google/oauth/callback`;
}

export function buildAuthorizeUrl(args: {
  purpose: Purpose;
  origin: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: buildRedirectUri(args.origin),
    response_type: "code",
    scope: PURPOSE_SCOPES[args.purpose].join(" "),
    access_type: "offline",          // required to get a refresh_token
    include_granted_scopes: "true",
    // "select_account" forces the account picker so users can pick a non-default
    // Google account (the firm's GBP-managing account isn't always the browser's
    // default Gmail). "consent" forces refresh_token issuance even on re-auth.
    prompt: "select_account consent",
    state: args.state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
};

export async function exchangeCodeForTokens(args: {
  code: string;
  origin: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    redirect_uri: buildRedirectUri(args.origin),
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function fetchUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token storage (Supabase) + auto-refresh
// ---------------------------------------------------------------------------

const REFRESH_BUFFER_SEC = 60; // refresh if token expires in less than this

export type StoredToken = {
  id: string;
  purpose: Purpose;
  scopes: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  granted_email: string | null;
};

export async function saveTokens(args: {
  purpose: Purpose;
  tokens: TokenResponse;
  granted_email: string | null;
  preserveRefreshTokenIfMissing?: boolean;
  tenantId?: string;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const tid = args.tenantId ?? (await resolveTenantId());
  const expiresAt = new Date(Date.now() + args.tokens.expires_in * 1000).toISOString();

  // Google sometimes omits refresh_token on re-auth; preserve the existing one.
  let refreshToken = args.tokens.refresh_token;
  if (!refreshToken && args.preserveRefreshTokenIfMissing) {
    const existing = await getStoredToken(args.purpose, tid);
    refreshToken = existing?.refresh_token;
  }
  if (!refreshToken) {
    throw new Error(
      "No refresh_token returned. Force consent prompt by re-authorizing.",
    );
  }

  const row = {
    purpose: args.purpose,
    scopes: args.tokens.scope,
    access_token: args.tokens.access_token,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    granted_email: args.granted_email,
    updated_at: new Date().toISOString(),
    tenant_id: tid,
  };

  const { error } = await supabase
    .from("google_oauth_tokens")
    .upsert(row, { onConflict: "tenant_id,purpose" });
  if (error) throw new Error(`Failed to save tokens: ${error.message}`);
}

export async function getStoredToken(
  purpose: Purpose,
  tenantId?: string,
): Promise<StoredToken | null> {
  const supabase = getSupabaseAdmin();
  const tid = tenantId ?? (await resolveTenantId());
  const { data, error } = await supabase
    .from("google_oauth_tokens")
    .select("*")
    .eq("tenant_id", tid)
    .eq("purpose", purpose)
    .maybeSingle();
  if (error) return null;
  return (data as StoredToken | null) ?? null;
}

export async function deleteStoredToken(
  purpose: Purpose,
  tenantId?: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const tid = tenantId ?? (await resolveTenantId());
  await supabase
    .from("google_oauth_tokens")
    .delete()
    .eq("tenant_id", tid)
    .eq("purpose", purpose);
}

/**
 * Lazy backfill for `granted_email`. Older OAuth grants (pre-`openid email`
 * scope) saved tokens without capturing the user email — the /integrations
 * page then shows "Connected as (unknown)". On read, if granted_email is
 * null but we have a valid access token + the right scope, fetch the email
 * via the userinfo endpoint and persist it back. Subsequent reads short-
 * circuit on the stored value.
 *
 * Returns the email (newly fetched or already stored), or null if the user
 * needs to reconnect to add the email scope.
 */
export async function ensureGrantedEmail(
  purpose: Purpose,
  tenantId?: string,
): Promise<string | null> {
  const tid = tenantId ?? (await resolveTenantId());
  const stored = await getStoredToken(purpose, tid);
  if (!stored) return null;
  if (stored.granted_email) return stored.granted_email;

  const valid = await getValidAccessToken(purpose, tid);
  if (!valid) return null;

  const email = await fetchUserEmail(valid.token);
  if (!email) return null;

  const supabase = getSupabaseAdmin();
  await supabase
    .from("google_oauth_tokens")
    .update({
      granted_email: email,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tid)
    .eq("purpose", purpose);
  return email;
}

/**
 * Returns a valid access token for the given purpose, refreshing it if the
 * stored one is near expiry. Returns null if no token has been stored yet
 * (caller should redirect the user through the consent flow).
 */
export async function getValidAccessToken(
  purpose: Purpose,
  tenantId?: string,
): Promise<{ token: string; granted_email: string | null } | null> {
  const tid = tenantId ?? (await resolveTenantId());
  const stored = await getStoredToken(purpose, tid);
  if (!stored) return null;

  const expiresAt = new Date(stored.expires_at).getTime();
  const now = Date.now();

  if (expiresAt - now > REFRESH_BUFFER_SEC * 1000) {
    return { token: stored.access_token, granted_email: stored.granted_email };
  }

  // Expired or about to — refresh.
  try {
    const refreshed = await refreshAccessToken(stored.refresh_token);
    await saveTokens({
      purpose,
      tokens: refreshed,
      granted_email: stored.granted_email,
      preserveRefreshTokenIfMissing: true,
      tenantId: tid,
    });
    return { token: refreshed.access_token, granted_email: stored.granted_email };
  } catch (err) {
    console.error("[google-oauth] refresh failed:", err);
    // Stale stored token; the user needs to re-authorize.
    return null;
  }
}
