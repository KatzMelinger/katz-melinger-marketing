import { NextRequest, NextResponse } from "next/server";

import { getConstantContactAuthUrl } from "@/lib/constant-contact-server";

export const dynamic = "force-dynamic";

function randomState(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next") || "/constant-contact";
  const state = randomState();
  const authUrl = getConstantContactAuthUrl(state);

  if (!authUrl) {
    return NextResponse.json(
      {
        error:
          "OAuth configuration missing. Set CONSTANT_CONTACT_CLIENT_ID, CONSTANT_CONTACT_CLIENT_SECRET, and CONSTANT_CONTACT_REDIRECT_URI.",
      },
      { status: 503 },
    );
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("cc_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 15 * 60,
  });
  response.cookies.set("cc_oauth_next", next, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 15 * 60,
  });
  return response;
}
