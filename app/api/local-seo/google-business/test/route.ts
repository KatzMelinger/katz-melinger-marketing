import { NextResponse } from "next/server";

import { parseGoogleApiErrorJson } from "@/lib/google-api-errors";
import {
  GBP_ACCOUNT_MANAGEMENT_V1_BASE,
  GBP_MYBUSINESS_V4_BASE,
  GBP_OAUTH_SCOPE,
  gbpFetch,
} from "@/lib/gbp-http";
import { getGoogleAccessToken } from "@/lib/google-access-token";
import { describeServiceAccountJson } from "@/lib/google-service-account";

export const dynamic = "force-dynamic";

function stripAccountPrefix(id: string): string {
  const t = id.trim();
  return t.startsWith("accounts/") ? t.slice("accounts/".length) : t;
}

function stripLocationPrefix(id: string): string {
  const t = id.trim();
  if (t.includes("/locations/")) {
    const after = t.split("/locations/")[1] ?? t;
    return after.split("/")[0] ?? after;
  }
  return t.startsWith("locations/") ? t.slice("locations/".length) : t;
}

type Step = { step: string; ok: boolean; detail: unknown };

export async function GET() {
  const steps: Step[] = [];
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? "";

  const desc = describeServiceAccountJson(raw || undefined);
  steps.push({
    step: "describe_service_account_json",
    ok: desc.jsonParseOk && desc.privateKeyLooksLikePem === true,
    detail: {
      ...desc,
      requiredScope: GBP_OAUTH_SCOPE,
      note:
        "Enable Google My Business API in GCP. Add the service account client_email as a user (Owner/Manager) on the Google Business Profile.",
    },
  });

  const auth = await getGoogleAccessToken([GBP_OAUTH_SCOPE]);
  if ("error" in auth) {
    steps.push({ step: "access_token", ok: false, detail: { error: auth.error } });
    return NextResponse.json(
      { ok: false, steps, summary: "Could not obtain OAuth access token." },
      { status: 200 },
    );
  }

  steps.push({
    step: "access_token",
    ok: true,
    detail: { tokenLength: auth.token.length, scope: GBP_OAUTH_SCOPE },
  });

  const listUrl = `${GBP_ACCOUNT_MANAGEMENT_V1_BASE}/accounts`;
  const listRes = await gbpFetch("test-list-accounts", listUrl, auth.token);
  const listBody = await listRes.text();
  const listParsed = parseGoogleApiErrorJson(
    listRes.status,
    listRes.statusText,
    listBody,
  );
  let accountsJson: unknown = null;
  try {
    accountsJson = listBody ? JSON.parse(listBody) : null;
  } catch {
    accountsJson = { raw: listBody.slice(0, 500) };
  }

  steps.push({
    step: "account_management_list_accounts",
    ok: listRes.ok,
    detail: listRes.ok
      ? {
          status: listRes.status,
          accounts:
            (accountsJson as { accounts?: { name?: string }[] })?.accounts?.map(
              (a) => a.name,
            ) ?? accountsJson,
        }
      : {
          status: listRes.status,
          googleError: listParsed,
        },
  });

  const accountId = stripAccountPrefix(
    process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim() ?? "",
  );
  const locationId = stripLocationPrefix(
    process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim() ?? "",
  );

  if (!accountId) {
    steps.push({
      step: "location_probe_skipped",
      ok: false,
      detail: { reason: "GOOGLE_BUSINESS_ACCOUNT_ID not set" },
    });
    return NextResponse.json({
      ok: listRes.ok,
      steps,
      summary:
        "Token and account list checked. Set GOOGLE_BUSINESS_ACCOUNT_ID and GOOGLE_BUSINESS_LOCATION_ID to test the v4 location GET.",
    });
  }

  if (!locationId) {
    steps.push({
      step: "location_probe_skipped",
      ok: false,
      detail: { reason: "GOOGLE_BUSINESS_LOCATION_ID not set", accountId },
    });
    return NextResponse.json({
      ok: listRes.ok,
      steps,
      summary:
        "Account list succeeded but location id missing — set GOOGLE_BUSINESS_LOCATION_ID.",
    });
  }

  const acc = encodeURIComponent(accountId);
  const loc = encodeURIComponent(locationId);
  const locationUrl = `${GBP_MYBUSINESS_V4_BASE}/accounts/${acc}/locations/${loc}`;
  const locRes = await gbpFetch("test-get-location-v4", locationUrl, auth.token);
  const locBody = await locRes.text();
  const locParsed = parseGoogleApiErrorJson(
    locRes.status,
    locRes.statusText,
    locBody,
  );

  steps.push({
    step: "mybusiness_v4_get_location",
    ok: locRes.ok,
    detail: locRes.ok
      ? { status: locRes.status, url: locationUrl }
      : { status: locRes.status, url: locationUrl, googleError: locParsed },
  });

  const ok = Boolean(listRes.ok && locRes.ok);

  return NextResponse.json({
    ok,
    steps,
    summary: ok
      ? "Service account authentication and location lookup succeeded."
      : "One or more steps failed — inspect steps[].detail.googleError for Google API messages.",
    resolved: { accountId, locationId },
  });
}
