/**
 * Google Business Profile (legacy v4 + account management) HTTP helpers.
 *
 * Required OAuth scope for these APIs:
 *   https://www.googleapis.com/auth/business.manage
 *
 * Enable in GCP:
 * - mybusiness.googleapis.com
 * - mybusinessaccountmanagement.googleapis.com
 * The service account email must be added as a user on the Business Profile / location.
 */

export const GBP_OAUTH_SCOPE = "https://www.googleapis.com/auth/business.manage";

/** Google My Business API v4 (Business Profile data, locations, reviews, …) */
export const GBP_MYBUSINESS_V4_BASE = "https://mybusiness.googleapis.com/v4";

/** Account Management API v1 — list accounts (good smoke test for token + scope). */
export const GBP_ACCOUNT_MANAGEMENT_V1_BASE =
  "https://mybusinessaccountmanagement.googleapis.com/v1";

export async function gbpFetch(
  label: string,
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const method = init?.method ?? "GET";
  console.log(`[GBP] ${label} → ${method} ${url}`, {
    authorization: `Bearer *** (length ${accessToken.length})`,
  });
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers,
  });
  const ct = res.headers.get("content-type") ?? "";
  console.log(`[GBP] ${label} ← ${res.status} ${res.statusText}`, { contentType: ct });
  return res;
}
