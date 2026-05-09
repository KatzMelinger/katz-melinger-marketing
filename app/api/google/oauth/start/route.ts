/**
 * GET /api/google/oauth/start?purpose=gbp
 *
 * Redirects the user to Google's consent screen with the appropriate scopes
 * for the requested purpose. The callback at /api/google/oauth/callback will
 * exchange the returned code for tokens and persist them in Supabase.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, type Purpose } from "@/lib/google-oauth";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

const ALLOWED: Purpose[] = ["gbp"];

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const purpose = (searchParams.get("purpose") as Purpose) ?? "gbp";
  if (!ALLOWED.includes(purpose)) {
    return NextResponse.json({ error: `Invalid purpose: ${purpose}` }, { status: 400 });
  }

  // CSRF-style token round-tripped through the cookie + state param.
  const state = randomBytes(24).toString("hex");
  const url = buildAuthorizeUrl({ purpose, origin, state });

  const res = NextResponse.redirect(url);
  res.cookies.set(`oauth_state_${purpose}`, state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    maxAge: 600, // 10 min to complete the consent
    path: "/",
  });
  return res;
}
