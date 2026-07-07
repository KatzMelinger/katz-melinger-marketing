import { GoogleAuth } from "google-auth-library";

import {
  describeServiceAccountJson,
  parseServiceAccountJson,
} from "@/lib/google-service-account";
import { getValidAccessToken } from "@/lib/google-oauth";
import { getTenantSecret } from "@/lib/tenant-secrets";

const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

export async function getGoogleAccessToken(
  scopes: string[],
  tenantId?: string,
): Promise<{ token: string } | { error: string }> {
  // For Business Profile we require the user-OAuth token (stored after the
  // /api/google/oauth/start flow). We deliberately do NOT fall back to the
  // service account here: a service account can't be granted access to a
  // Business Profile listing, so that path only yields a confusing 403
  // "caller does not have permission". When there's no usable OAuth token
  // (never connected, or the refresh token expired), return an actionable
  // "reconnect" error the UI can surface directly.
  if (scopes.includes(GBP_SCOPE)) {
    try {
      const oauth = await getValidAccessToken("gbp", tenantId);
      if (oauth) {
        if (process.env.GOOGLE_DEBUG_AUTH === "1") {
          console.log("[GoogleAuth] using stored OAuth token for GBP", {
            grantedEmail: oauth.granted_email,
          });
        }
        return { token: oauth.token };
      }
      return {
        error:
          "Google Business Profile isn't connected, or its access token expired. Reconnect it on /integrations — click “Connect Google Business Profile” and sign in with the Google account that manages the listing.",
      };
    } catch (err) {
      console.warn("[GoogleAuth] GBP OAuth token lookup failed", err);
      return {
        error:
          "Google Business Profile token lookup failed. Reconnect it on /integrations, then try again.",
      };
    }
  }

  // Per-tenant service account (B5): the firm's own GA4/GSC credentials, or the
  // platform env var for the default tenant. A non-default firm with none set
  // gets undefined → a clear "not configured" error rather than KM's data.
  const raw = (await getTenantSecret("GOOGLE_SERVICE_ACCOUNT_JSON", tenantId))?.trim();
  if (!raw) {
    return { error: "GOOGLE_SERVICE_ACCOUNT_JSON is not set for this firm" };
  }

  if (process.env.GOOGLE_DEBUG_AUTH === "1") {
    const desc = describeServiceAccountJson(raw);
    console.log("[GoogleAuth] service account JSON (safe):", desc);
  }

  const parsed = parseServiceAccountJson(raw);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  const credentials = parsed.credentials;

  try {
    const auth = new GoogleAuth({ credentials, scopes });
    const client = await auth.getClient();
    const access = await client.getAccessToken();
    const token = access.token;
    if (!token) {
      console.error("[GoogleAuth] getAccessToken returned no token", {
        res: access.res?.data,
      });
      return { error: "No access token returned from Google" };
    }
    if (process.env.GOOGLE_DEBUG_AUTH === "1") {
      console.log("[GoogleAuth] access token issued", {
        scopes,
        tokenLength: token.length,
      });
    }
    return { token };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Google auth failed";
    console.error("[GoogleAuth] getAccessToken failed", {
      scopes,
      message,
      stack: e instanceof Error ? e.stack : undefined,
    });
    return { error: message };
  }
}
