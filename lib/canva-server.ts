/**
 * Canva Connect API — OAuth 2.0 (Authorization Code + PKCE) server helpers.
 *
 * Tokens are stored in the shared `oauth_tokens` table (provider='canva'),
 * tenant-scoped, exactly like Constant Contact — no Canva-specific table.
 *
 * Canva REQUIRES PKCE for the authorization code flow, so start/callback pass
 * a code_verifier (stashed in an httpOnly cookie between the two hops). The
 * token endpoint authenticates the confidential client with HTTP Basic.
 *
 * Docs: https://www.canva.dev/docs/connect/authentication/
 */

import { createHash, randomBytes } from "node:crypto";

import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

const CANVA_AUTH_URL = "https://www.canva.com/api/oauth/authorize";
const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";

// Sensible default for brand-template design generation; override with
// CANVA_OAUTH_SCOPES (space-separated) if the connected app needs more/less.
const DEFAULT_SCOPES =
  "profile:read brandtemplate:meta:read brandtemplate:content:read design:meta:read design:content:read design:content:write asset:read";

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

export function getCanvaOAuthConfig(): OAuthConfig | { error: string } {
  const clientId = process.env.CANVA_CLIENT_ID?.trim();
  const clientSecret = process.env.CANVA_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.CANVA_REDIRECT_URI?.trim() ||
    `${process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000"}/api/canva/oauth/callback`;
  if (!clientId) return { error: "Missing CANVA_CLIENT_ID" };
  if (!clientSecret) return { error: "Missing CANVA_CLIENT_SECRET" };
  return { clientId, clientSecret, redirectUri };
}

export function isCanvaOAuthConfigured(): boolean {
  return !("error" in getCanvaOAuthConfig());
}

/** Generate a PKCE verifier (43 chars) and its S256 challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
}

export function getCanvaAuthUrl(state: string, codeChallenge: string): string {
  const cfg = getCanvaOAuthConfig();
  if ("error" in cfg) return "";
  const scope = process.env.CANVA_OAUTH_SCOPES?.trim() || DEFAULT_SCOPES;
  const u = new URL(CANVA_AUTH_URL);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("scope", scope);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function tokenRequest(
  params: URLSearchParams,
): Promise<OAuthTokenResponse> {
  const cfg = getCanvaOAuthConfig();
  if ("error" in cfg) throw new Error(cfg.error);

  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
    "base64",
  );
  const body = new URLSearchParams(params);
  body.set("redirect_uri", cfg.redirectUri);

  const res = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `Canva token exchange failed (${res.status}): ${JSON.stringify(json)}`,
    );
  }
  return json as OAuthTokenResponse;
}

export async function exchangeCanvaCode(
  code: string,
  codeVerifier: string,
): Promise<OAuthTokenResponse> {
  if (!code.trim()) throw new Error("Missing Canva authorization code");
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: code.trim(),
      code_verifier: codeVerifier,
    }),
  );
}

export async function persistCanvaTokens(
  tokens: OAuthTokenResponse,
): Promise<void> {
  if (!tokens.access_token) {
    throw new Error("Missing access_token in Canva token response");
  }
  const sb = getSupabaseServer();
  if (!sb) throw new Error("Supabase is not configured for OAuth token storage.");

  const tid = await resolveTenantId();
  const expiresAt =
    typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in)
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;
  const refreshToken =
    typeof tokens.refresh_token === "string" && tokens.refresh_token.trim()
      ? tokens.refresh_token
      : null;

  const { data: existing } = await sb
    .from("oauth_tokens")
    .select("id")
    .eq("tenant_id", tid)
    .eq("provider", "canva")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await sb
      .from("oauth_tokens")
      .update({
        access_token: tokens.access_token,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tid)
      .eq("id", existing.id);
    if (error) throw new Error(`Failed to update Canva tokens: ${error.message}`);
    return;
  }

  const { error } = await sb.from("oauth_tokens").insert({
    provider: "canva",
    tenant_id: tid,
    access_token: tokens.access_token,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`Failed to insert Canva tokens: ${error.message}`);
}

/** True iff a Canva access token is stored for the current tenant. */
export async function canvaConnected(): Promise<boolean> {
  const sb = getSupabaseServer();
  if (!sb) return false;
  try {
    const { data } = await sb
      .from("oauth_tokens")
      .select("access_token")
      .eq("tenant_id", await resolveTenantId())
      .eq("provider", "canva")
      .limit(1);
    return Boolean(data && data.length > 0 && data[0].access_token);
  } catch {
    return false;
  }
}

export async function disconnectCanva(): Promise<void> {
  const sb = getSupabaseServer();
  if (!sb) return;
  await sb
    .from("oauth_tokens")
    .delete()
    .eq("tenant_id", await resolveTenantId())
    .eq("provider", "canva");
}
