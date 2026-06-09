import { GoogleAuth } from "google-auth-library";

import {
  describeServiceAccountJson,
  parseServiceAccountJson,
} from "@/lib/google-service-account";
import { getValidAccessToken } from "@/lib/google-oauth";

const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

export async function getGoogleAccessToken(
  scopes: string[],
  tenantId?: string,
): Promise<{ token: string } | { error: string }> {
  // For Business Profile we prefer the user-OAuth token (stored after the
  // /api/google/oauth/start flow) since service accounts can't auto-accept
  // GBP invitations. Falls through to service-account auth if no OAuth token
  // is stored — that path will fail at the API call, but the error message
  // is clearer when it does.
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
    } catch (err) {
      console.warn("[GoogleAuth] OAuth token lookup failed, falling back to SA", err);
    }
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    return { error: "GOOGLE_SERVICE_ACCOUNT_JSON is not set" };
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
