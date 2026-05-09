/**
 * GET /api/google/oauth/callback?code=...&state=...
 *
 * Google redirects here after the user accepts (or denies) consent. We:
 *   1. Verify the state cookie matches the state param (CSRF protection)
 *   2. Exchange the code for tokens
 *   3. Look up the granting user's email
 *   4. Persist everything in google_oauth_tokens
 *   5. Redirect the user back to /integrations with a success/error flag
 */

import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  fetchUserEmail,
  saveTokens,
  type Purpose,
} from "@/lib/google-oauth";

export const runtime = "nodejs";

function bounceTo(url: URL, params: Record<string, string>): NextResponse {
  const u = new URL("/integrations", url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const purpose: Purpose = "gbp"; // single-purpose for now

  if (error) {
    return bounceTo(req.nextUrl, { gbp: "error", reason: error });
  }
  if (!code || !state) {
    return bounceTo(req.nextUrl, { gbp: "error", reason: "missing_code_or_state" });
  }

  const cookie = req.cookies.get(`oauth_state_${purpose}`)?.value;
  if (!cookie || cookie !== state) {
    return bounceTo(req.nextUrl, { gbp: "error", reason: "state_mismatch" });
  }

  try {
    const tokens = await exchangeCodeForTokens({ code, origin });
    const email = await fetchUserEmail(tokens.access_token);
    await saveTokens({
      purpose,
      tokens,
      granted_email: email,
      preserveRefreshTokenIfMissing: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "exchange failed";
    return bounceTo(req.nextUrl, { gbp: "error", reason: msg });
  }

  // Clear the CSRF cookie.
  const res = bounceTo(req.nextUrl, { gbp: "connected" });
  res.cookies.delete(`oauth_state_${purpose}`);
  return res;
}
