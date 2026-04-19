import { NextResponse } from "next/server";

import { GBP_OAUTH_SCOPE } from "@/lib/gbp-http";
import { describeServiceAccountJson } from "@/lib/google-service-account";

export const dynamic = "force-dynamic";

export async function GET() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  if (!raw) {
    return NextResponse.json({
      configured: false,
      gbpRequiredScope: GBP_OAUTH_SCOPE,
      error: "GOOGLE_SERVICE_ACCOUNT_JSON is not set",
    });
  }

  const desc = describeServiceAccountJson(raw);
  const configured = Boolean(
    desc.jsonParseOk &&
      desc.privateKeyPresent &&
      desc.privateKeyLooksLikePem &&
      desc.clientEmail,
  );

  if (!desc.jsonParseOk) {
    return NextResponse.json({
      configured: false,
      gbpRequiredScope: GBP_OAUTH_SCOPE,
      serviceAccount: desc,
      error: desc.parseError ?? "Invalid JSON",
    });
  }

  if (!configured) {
    return NextResponse.json({
      configured: false,
      gbpRequiredScope: GBP_OAUTH_SCOPE,
      serviceAccount: desc,
      error:
        "GOOGLE_SERVICE_ACCOUNT_JSON must include valid client_email and PEM private_key",
    });
  }

  return NextResponse.json({
    configured: true,
    gbpRequiredScope: GBP_OAUTH_SCOPE,
    serviceAccount: desc,
    note:
      "Enable Google My Business API in GCP. Add client_email as a user on the Business Profile. Set GOOGLE_DEBUG_AUTH=1 for verbose auth logs.",
  });
}
