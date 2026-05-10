/**
 * Google Business Profile HTTP helpers.
 *
 * Required OAuth scope for these APIs:
 *   https://www.googleapis.com/auth/business.manage
 *
 * Enable in GCP:
 * - mybusinessaccountmanagement.googleapis.com   (account list)
 * - mybusinessbusinessinformation.googleapis.com (locations CRUD; replaces v4)
 * - mybusiness.googleapis.com                    (legacy; reviews + media still here)
 *
 * The service account email (or OAuth-connected user) must be added as a
 * manager on the Business Profile / location.
 */

export const GBP_OAUTH_SCOPE = "https://www.googleapis.com/auth/business.manage";

/**
 * Legacy My Business v4 endpoints — Google deprecated locations under this
 * base in 2022. Reviews and media are still served here (no v1 replacement
 * yet); locations and account-listing have moved.
 */
export const GBP_MYBUSINESS_V4_BASE = "https://mybusiness.googleapis.com/v4";

/** Account Management API v1 — list accounts. */
export const GBP_ACCOUNT_MANAGEMENT_V1_BASE =
  "https://mybusinessaccountmanagement.googleapis.com/v1";

/** Business Information API v1 — locations CRUD (replaces v4 locations). */
export const GBP_BUSINESS_INFO_V1_BASE =
  "https://mybusinessbusinessinformation.googleapis.com/v1";

/**
 * readMask required for v1 Business Information location calls. Includes the
 * fields the dashboard renders. Add to this list as features need more.
 */
export const GBP_LOCATION_READ_MASK = [
  "name",
  "title",
  "storefrontAddress",
  "websiteUri",
  "phoneNumbers",
  "categories",
  "regularHours",
  "specialHours",
  "labels",
  "metadata",
  "openInfo",
  "profile",
  "latlng",
].join(",");

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
