import { GoogleAuth } from "google-auth-library";

export async function getGoogleAccessToken(
  scopes: string[],
): Promise<{ token: string } | { error: string }> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    return { error: "GOOGLE_SERVICE_ACCOUNT_JSON is not set" };
  }
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { error: "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON" };
  }
  try {
    const auth = new GoogleAuth({ credentials, scopes });
    const client = await auth.getClient();
    const access = await client.getAccessToken();
    const token = access.token;
    if (!token) {
      return { error: "No access token returned from Google" };
    }
    return { token };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Google auth failed";
    return { error: message };
  }
}
