import { GoogleAuth } from "google-auth-library";

import {
  describeServiceAccountJson,
  parseServiceAccountJson,
} from "@/lib/google-service-account";

export async function getGoogleAccessToken(
  scopes: string[],
): Promise<{ token: string } | { error: string }> {
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
