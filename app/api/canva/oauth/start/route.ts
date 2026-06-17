/**
 * GET /api/canva/oauth/start
 *
 * Kicks off the Canva Connect OAuth flow. Generates PKCE + state, stashes them
 * in httpOnly cookies, and redirects the admin to Canva's consent screen.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import {
  generatePkce,
  getCanvaAuthUrl,
  randomState,
} from "@/lib/canva-server";

export const dynamic = "force-dynamic";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 15 * 60,
};

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  const state = randomState();
  const { verifier, challenge } = generatePkce();
  const authUrl = getCanvaAuthUrl(state, challenge);

  if (!authUrl) {
    return NextResponse.json(
      {
        error:
          "Canva OAuth is not configured. Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET (and optionally CANVA_REDIRECT_URI).",
      },
      { status: 503 },
    );
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("canva_oauth_state", state, COOKIE_OPTS);
  response.cookies.set("canva_oauth_verifier", verifier, COOKIE_OPTS);
  return response;
}
