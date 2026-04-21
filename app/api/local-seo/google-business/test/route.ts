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
      requiredApis: [
        "mybusiness.googleapis.com (Business Profile API v4)",
        "mybusinessaccountmanagement.googleapis.com (Account Management API v1)",
      ],
      note:
        "Add service account client_email as Manager/Owner on the Business Profile account.",
    },
  });

  const auth = await getGoogleAccessToken([GBP_OAUTH_SCOPE]);
  if ("error" in auth) {
    steps.push({ step: "access_token", ok: false, detail: { error: auth.error } });
    return NextResponse.json(
      {
        ok: false,
        steps,
        summary: "Could not obtain OAuth access token.",
      },
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
  const listText = await listRes.text();
  const listParsed = parseGoogleApiErrorJson(listRes.status, listRes.statusText, listText);
  let listJson: unknown = null;
  try {
    listJson = listText ? JSON.parse(listText) : null;
  } catch {
    listJson = { raw: listText.slice(0, 500) };
  }
  const accounts = ((listJson as { accounts?: Array<{ name?: string; accountName?: string }> })?.accounts ?? [])
    .map((a) => ({
      accountId: stripAccountPrefix(String(a.name ?? "")),
      name: String(a.accountName ?? a.name ?? "Business account"),
    }))
    .filter((a) => Boolean(a.accountId));

  steps.push({
    step: "account_management_list_accounts",
    ok: listRes.ok,
    detail: listRes.ok
      ? { status: listRes.status, accounts }
      : { status: listRes.status, googleError: listParsed },
  });

  const accountId = stripAccountPrefix(process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim() ?? "");
  const locationId = stripLocationPrefix(process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim() ?? "");

  if (!accountId) {
    steps.push({
      step: "configured_account_missing",
      ok: false,
      detail: { message: "GOOGLE_BUSINESS_ACCOUNT_ID is not configured." },
    });
    return NextResponse.json({
      ok: listRes.ok,
      steps,
      discoveredAccounts: accounts,
      summary: "Account discovery succeeded, but no default account ID is configured.",
    });
  }

  const locationsUrl = `${GBP_MYBUSINESS_V4_BASE}/accounts/${encodeURIComponent(accountId)}/locations?pageSize=100`;
  const locsRes = await gbpFetch("test-list-locations", locationsUrl, auth.token);
  const locsText = await locsRes.text();
  const locsParsed = parseGoogleApiErrorJson(locsRes.status, locsRes.statusText, locsText);
  let locsJson: unknown = null;
  try {
    locsJson = locsText ? JSON.parse(locsText) : null;
  } catch {
    locsJson = { raw: locsText.slice(0, 500) };
  }
  const discoveredLocations = ((locsJson as {
    locations?: Array<{ name?: string; title?: string }>;
  })?.locations ?? []).map((l) => ({
    locationId: stripLocationPrefix(String(l.name ?? "")),
    title: String(l.title ?? "Location"),
    name: String(l.name ?? ""),
  }));

  steps.push({
    step: "list_locations_for_configured_account",
    ok: locsRes.ok,
    detail: locsRes.ok
      ? { status: locsRes.status, count: discoveredLocations.length }
      : { status: locsRes.status, googleError: locsParsed },
  });

  if (!locationId) {
    steps.push({
      step: "configured_location_missing",
      ok: false,
      detail: { message: "GOOGLE_BUSINESS_LOCATION_ID is not configured." },
    });
    return NextResponse.json({
      ok: listRes.ok && locsRes.ok,
      steps,
      discoveredAccounts: accounts,
      discoveredLocations,
      summary:
        "Account and location discovery executed. Configure or select a valid location ID.",
    });
  }

  const locationUrl = `${GBP_MYBUSINESS_V4_BASE}/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}`;
  const oneRes = await gbpFetch("test-get-location", locationUrl, auth.token);
  const oneText = await oneRes.text();
  const oneParsed = parseGoogleApiErrorJson(oneRes.status, oneRes.statusText, oneText);

  steps.push({
    step: "get_configured_location",
    ok: oneRes.ok,
    detail: oneRes.ok
      ? { status: oneRes.status, accountId, locationId }
      : { status: oneRes.status, googleError: oneParsed, accountId, locationId },
  });

  const ok = Boolean(listRes.ok && locsRes.ok && oneRes.ok);
  return NextResponse.json({
    ok,
    steps,
    discoveredAccounts: accounts,
    discoveredLocations,
    resolved: { accountId, locationId },
    summary: ok
      ? "Authentication and configured account/location checks succeeded."
      : "Some checks failed. Use discovered accounts/locations and verify permissions/API enablement.",
  });
}
