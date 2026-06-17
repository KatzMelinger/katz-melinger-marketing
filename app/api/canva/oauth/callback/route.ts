/**
 * GET /api/canva/oauth/callback
 *
 * Canva redirects here with ?code & ?state. We verify state against the cookie,
 * exchange the code (with the stored PKCE verifier) for tokens, persist them
 * tenant-scoped, and bounce back to /integrations with a status flag.
 */

import { NextRequest, NextResponse } from "next/server";

import { exchangeCanvaCode, persistCanvaTokens } from "@/lib/canva-server";

export const dynamic = "force-dynamic";

function backToIntegrations(
  base: URL,
  params: Record<string, string>,
): NextResponse {
  const target = new URL("/integrations", base.origin);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  const res = NextResponse.redirect(target);
  res.cookies.delete("canva_oauth_state");
  res.cookies.delete("canva_oauth_verifier");
  return res;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const providerDescription = url.searchParams.get("error_description");

  if (providerError) {
    return backToIntegrations(url, {
      canva: "error",
      reason: providerDescription || providerError,
    });
  }

  const expectedState = request.cookies.get("canva_oauth_state")?.value;
  const verifier = request.cookies.get("canva_oauth_verifier")?.value;
  if (!state || !expectedState || state !== expectedState) {
    return backToIntegrations(url, {
      canva: "error",
      reason: "Invalid OAuth state — please try connecting again.",
    });
  }
  if (!verifier) {
    return backToIntegrations(url, {
      canva: "error",
      reason: "Missing PKCE verifier — please try connecting again.",
    });
  }
  if (!code) {
    return backToIntegrations(url, {
      canva: "error",
      reason: "Missing authorization code from Canva.",
    });
  }

  try {
    const tokens = await exchangeCanvaCode(code, verifier);
    await persistCanvaTokens(tokens);
    return backToIntegrations(url, { canva: "connected" });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Token exchange failed.";
    return backToIntegrations(url, { canva: "error", reason });
  }
}
