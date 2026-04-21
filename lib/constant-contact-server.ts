import { NextRequest, NextResponse } from "next/server";

import { fetchCmsJson } from "@/lib/cms-server";
import { getSupabaseServer } from "@/lib/supabase-server";

export const CONSTANT_CONTACT_API_BASE = "https://api.cc.email/v3";
const CONSTANT_CONTACT_AUTH_BASE =
  process.env.CONSTANT_CONTACT_AUTH_BASE?.trim() ||
  "https://authz.constantcontact.com/oauth2/default/v1";

export type ConstantContactApiErrorBody = {
  error_key?: string;
  error_message?: string;
  errors?: Array<{ error_key?: string; error_message?: string }>;
  [key: string]: unknown;
};

export type ContactListRow = {
  list_id?: string;
  name?: string;
  description?: string;
  membership_count?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type ContactListsApiResponse = {
  lists?: ContactListRow[];
  lists_count?: number;
  [key: string]: unknown;
};

export type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type StoredCcTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};

export type CcAuthFailureJson = {
  error: string;
  status: 401;
  needsAuth: true;
  authUrl: string;
  details?: unknown;
};

export async function getAuthConfig():
  Promise<{ accessToken: string; refreshToken: string | null } | { error: string }> {
  const tokens = await getLatestConstantContactTokens();
  if ("error" in tokens) {
    return { error: tokens.error };
  }
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

function getOAuthConfig(): OAuthConfig | { error: string } {
  const clientId = process.env.CONSTANT_CONTACT_CLIENT_ID?.trim();
  const clientSecret = process.env.CONSTANT_CONTACT_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.CONSTANT_CONTACT_REDIRECT_URI?.trim() ||
    `${process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000"}/api/constant-contact/oauth/callback`;

  if (!clientId) return { error: "Missing CONSTANT_CONTACT_CLIENT_ID" };
  if (!clientSecret) return { error: "Missing CONSTANT_CONTACT_CLIENT_SECRET" };
  if (!redirectUri) return { error: "Missing CONSTANT_CONTACT_REDIRECT_URI" };
  return { clientId, clientSecret, redirectUri };
}

export function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export async function getLatestConstantContactTokens():
  Promise<StoredCcTokens | { error: string }> {
  const sb = getSupabaseServer();
  if (!sb) {
    return { error: "Supabase is not configured for OAuth token storage." };
  }

  const { data, error } = await sb
    .from("oauth_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("provider", "constant_contact")
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      error: `Failed to load Constant Contact OAuth tokens from Supabase: ${error.message}`,
    };
  }
  if (!data?.access_token) {
    return {
      error: "No Constant Contact OAuth tokens stored. Reconnect Constant Contact.",
    };
  }

  return {
    accessToken: String(data.access_token),
    refreshToken:
      typeof data.refresh_token === "string" && data.refresh_token.trim()
        ? data.refresh_token
        : null,
    expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
  };
}

export async function persistConstantContactTokens(
  tokens: OAuthTokenResponse,
): Promise<void> {
  if (!tokens.access_token) {
    throw new Error("Missing access_token in OAuth token response");
  }

  const sb = getSupabaseServer();
  if (!sb) {
    throw new Error("Supabase is not configured for OAuth token storage.");
  }

  const current = await getLatestConstantContactTokens();
  const expiresAt =
    typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in)
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;
  const refreshToken =
    typeof tokens.refresh_token === "string" && tokens.refresh_token.trim()
      ? tokens.refresh_token
      : "error" in current
        ? null
        : current.refreshToken;

  const { data: existing, error: existingError } = await sb
    .from("oauth_tokens")
    .select("id")
    .eq("provider", "constant_contact")
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to load existing OAuth token row: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await sb
      .from("oauth_tokens")
      .update({
        access_token: tokens.access_token,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) {
      throw new Error(`Failed to update OAuth tokens: ${error.message}`);
    }
    return;
  }

  const { error } = await sb.from("oauth_tokens").insert({
    provider: "constant_contact",
    access_token: tokens.access_token,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  });
  if (error) {
    throw new Error(`Failed to insert OAuth tokens: ${error.message}`);
  }
}

export function getConstantContactAuthUrl(state: string): string {
  const cfg = getOAuthConfig();
  if ("error" in cfg) return "";

  const scope =
    process.env.CONSTANT_CONTACT_OAUTH_SCOPES?.trim() ||
    "account_read contact_data campaign_data";

  const u = new URL(`${CONSTANT_CONTACT_AUTH_BASE}/authorize`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("scope", scope);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(
  params: URLSearchParams,
): Promise<OAuthTokenResponse> {
  const cfg = getOAuthConfig();
  if ("error" in cfg) {
    throw new Error(cfg.error);
  }

  const body = new URLSearchParams(params);
  body.set("client_id", cfg.clientId);
  body.set("client_secret", cfg.clientSecret);
  body.set("redirect_uri", cfg.redirectUri);

  const response = await fetch(`${CONSTANT_CONTACT_AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  const json = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      `Constant Contact token exchange failed (${response.status}): ${JSON.stringify(json)}`,
    );
  }

  return json as OAuthTokenResponse;
}

export async function exchangeAuthorizationCode(
  code: string,
): Promise<OAuthTokenResponse> {
  if (!code.trim()) throw new Error("Missing OAuth authorization code");
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: code.trim(),
    }),
  );
}

export async function refreshAccessTokenIfPossible():
  Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const current = await getLatestConstantContactTokens();
  if ("error" in current) {
    return { ok: false, error: current.error };
  }
  const refreshToken = current.refreshToken;
  if (!refreshToken) {
    return { ok: false, error: "No refresh token available. Reconnect required." };
  }
  try {
    const tokens = await tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    );
    await persistConstantContactTokens(tokens);
    return { ok: true, accessToken: tokens.access_token };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function ccAuthedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const cfg = await getAuthConfig();
  if ("error" in cfg) {
    throw new Error(cfg.error);
  }

  const first = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...authHeaders(cfg.accessToken),
      ...(init?.headers ?? {}),
    },
  });
  if (first.status !== 401) return first;

  const refreshed = await refreshAccessTokenIfPossible();
  if (!refreshed.ok) {
    return first;
  }

  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...authHeaders(refreshed.accessToken),
      ...(init?.headers ?? {}),
    },
  });
}

function authFailureJson(message: string, details?: unknown): CcAuthFailureJson {
  return {
    error: message,
    status: 401,
    needsAuth: true,
    authUrl: getConstantContactAuthUrl("cc-reconnect"),
    ...(details !== undefined ? { details } : {}),
  };
}

function ccErrorResponse(
  body: unknown,
  res: Response,
  fallback: string,
): NextResponse {
  const err = body as ConstantContactApiErrorBody;
  const message =
    err?.error_message ??
    (typeof err?.error_key === "string" ? err.error_key : null) ??
    fallback;

  if (res.status === 401) {
    return NextResponse.json(authFailureJson(message, body), { status: 401 });
  }

  return NextResponse.json(
    {
      error: message,
      status: res.status,
      details: body,
    },
    { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
  );
}

export async function fetchContactListsResponse(): Promise<NextResponse> {
  const cfg = await getAuthConfig();
  if ("error" in cfg) {
    return NextResponse.json({ error: cfg.error }, { status: 503 });
  }

  const url = `${CONSTANT_CONTACT_API_BASE}/contact_lists?limit=1000&include_membership_count=active`;

  try {
    const res = await ccAuthedFetch(url);
    const body = await parseJsonSafe(res);

    if (!res.ok) {
      return ccErrorResponse(
        body,
        res,
        `Constant Contact API error (${res.status})`,
      );
    }

    const data = body as ContactListsApiResponse;
    const lists = Array.isArray(data.lists) ? data.lists : [];

    return NextResponse.json({
      lists,
      ...(typeof data.lists_count === "number"
        ? { lists_count: data.lists_count }
        : {}),
      ...(data._links ? { _links: data._links } : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch Constant Contact lists",
        details: message,
      },
      { status: 502 },
    );
  }
}

type SyncContactsResult =
  | { ok: true; synced: number; last_sync_at: string; message?: string }
  | { ok: false; error: string; needsAuth?: true; authUrl?: string };

/**
 * Verifies the list exists, optionally pulls CMS emails, and upserts contacts into CC.
 * CMS export path is optional; without exported emails, sync still records a successful
 * verification with synced count 0.
 */
export async function syncContactsToList(listId: string): Promise<SyncContactsResult> {
  const cfg = await getAuthConfig();
  if ("error" in cfg) {
    return { ok: false, error: cfg.error };
  }

  const listUrl = `${CONSTANT_CONTACT_API_BASE}/contact_lists/${encodeURIComponent(listId)}`;
  const listRes = await ccAuthedFetch(listUrl);
  const listBody = await parseJsonSafe(listRes);
  if (!listRes.ok) {
    if (listRes.status === 401) {
      return {
        ok: false,
        error: "Constant Contact token expired or revoked. Reconnect required.",
        needsAuth: true,
        authUrl: getConstantContactAuthUrl("cc-reconnect"),
      };
    }
    const err = listBody as ConstantContactApiErrorBody;
    return {
      ok: false,
      error:
        err?.error_message ??
        (typeof err?.error_key === "string" ? err.error_key : null) ??
        `Constant Contact could not load list (${listRes.status})`,
    };
  }

  const exportPath =
    process.env.CMS_CONTACT_EXPORT_PATH?.trim() || "/api/v1/marketing/contacts-export";

  const cmsPayload = await fetchCmsJson<{
    contacts?: Array<{ email_address?: string; email?: string }>;
    emails?: string[];
  }>(exportPath);

  let emails: string[] = [];
  if (cmsPayload?.emails?.length) {
    emails = cmsPayload.emails.map((e) => e.trim()).filter(Boolean);
  } else if (cmsPayload?.contacts?.length) {
    emails = cmsPayload.contacts
      .map((c) => c.email_address ?? c.email ?? "")
      .map((e) => e.trim())
      .filter(Boolean);
  }

  let synced = 0;
  const last_sync_at = new Date().toISOString();

  for (const address of emails) {
    const body = {
      email_address: { address, permission_to_send: "implicit" },
      create_source: "Account",
      list_memberships: [{ list_id: listId }],
    };
    const postRes = await ccAuthedFetch(`${CONSTANT_CONTACT_API_BASE}/contacts`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (postRes.ok || postRes.status === 409) {
      synced += 1;
    }
  }

  let message: string | undefined;
  if (emails.length === 0) {
    message =
      cmsPayload === null
        ? "CMS is not configured or the export endpoint failed. Set CMS_API_URL / CMS_API_SECRET_KEY and CMS_CONTACT_EXPORT_PATH (default /api/v1/marketing/contacts-export)."
        : "No email addresses in the CMS export. Expected { emails: string[] } or { contacts: [{ email_address or email }] }.";
  } else if (synced < emails.length) {
    message = `Imported ${synced} of ${emails.length} contact(s); some rows were skipped (duplicate or validation).`;
  }

  return {
    ok: true,
    synced,
    last_sync_at,
    ...(message ? { message } : {}),
  };
}

export function requireOAuthConfigured(request?: NextRequest): NextResponse | null {
  const cfg = getOAuthConfig();
  if ("error" in cfg) {
    return NextResponse.json({ error: cfg.error }, { status: 503 });
  }
  if (!request) return null;
  return null;
}
