import { NextRequest, NextResponse } from "next/server";

import {
  exchangeAuthorizationCode,
  persistConstantContactTokens,
} from "@/lib/constant-contact-server";

export const dynamic = "force-dynamic";

function errorRedirect(base: URL, message: string): NextResponse {
  const target = new URL("/constant-contact", base.origin);
  target.searchParams.set("auth_error", message);
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const providerDescription = url.searchParams.get("error_description");

  if (providerError) {
    const msg = providerDescription
      ? `${providerError}: ${providerDescription}`
      : providerError;
    return errorRedirect(url, msg);
  }

  const expectedState = request.cookies.get("cc_oauth_state")?.value;
  const nextPath = request.cookies.get("cc_oauth_next")?.value || "/constant-contact";
  if (!state || !expectedState || state !== expectedState) {
    return errorRedirect(url, "Invalid OAuth state. Please try connecting again.");
  }
  if (!code) {
    return errorRedirect(url, "Missing authorization code from Constant Contact.");
  }

  try {
    const tokens = await exchangeAuthorizationCode(code);
    await persistConstantContactTokens(tokens);

    const redirectTarget = new URL(nextPath, url.origin);
    redirectTarget.searchParams.set("auth_success", "1");
    const response = NextResponse.redirect(redirectTarget);
    response.cookies.delete("cc_oauth_state");
    response.cookies.delete("cc_oauth_next");
    return response;
  } catch (e) {
    return errorRedirect(
      url,
      e instanceof Error ? e.message : "Failed to exchange authorization code.",
    );
  }
}
