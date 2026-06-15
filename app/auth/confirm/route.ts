/**
 * GET /auth/confirm — server-side handler for email-link auth (password reset).
 *
 * Supabase recovery emails are configured to link here with a one-time
 * `token_hash` (see the "Reset Password" email template note in the admin
 * Users page / project docs). We verify it server-side with verifyOtp, which
 * — unlike the PKCE `?code=` flow — needs no code-verifier, so it works when
 * the link is opened in a different browser than the one that requested it
 * (e.g. an admin triggers a reset for a teammate). On success the session
 * cookie is written and we forward to the set-password page.
 *
 * Must be listed in proxy PUBLIC_PATHS: the visitor has no session yet.
 */

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";

import { getSupabaseRouteClient } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Only allow relative same-app next targets to avoid an open redirect.
  const nextParam = searchParams.get("next") ?? "/reset-password";
  const next = nextParam.startsWith("/") ? nextParam : "/reset-password";

  let target = "/login?error=invalid_link";
  if (tokenHash && type) {
    const supabase = await getSupabaseRouteClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    // verifyOtp writes the session cookie via the route client on success.
    target = error ? "/login?error=expired_link" : next;
  }

  // redirect() (not NextResponse.redirect) so Next attaches the cookie
  // mutations made via next/headers to the redirect response. Called outside
  // any try/catch since it signals via a thrown error.
  redirect(target);
}
