/**
 * Service account JSON from GOOGLE_SERVICE_ACCOUNT_JSON (often a single-line env value).
 * Escaped newlines in `private_key` must be normalized or JWT signing fails → 401.
 */

export type ServiceAccountDescription = {
  jsonParseOk: boolean;
  /** service_account vs other */
  credentialType?: string;
  clientEmail?: string;
  projectId?: string;
  privateKeyPresent?: boolean;
  /** True if key contains PEM markers after parsing */
  privateKeyLooksLikePem?: boolean;
  privateKeyCharLength?: number;
  /** Raw env string contained literal \n sequences (common when pasting JSON into .env) */
  hadEscapedNewlinesInEnv?: boolean;
  parseError?: string;
};

export function describeServiceAccountJson(raw: string | undefined): ServiceAccountDescription {
  if (raw == null || raw.trim() === "") {
    return { jsonParseOk: false, parseError: "empty" };
  }
  const hadEscaped = raw.includes("\\n") && raw.includes("BEGIN");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.private_key === "string") {
      parsed = {
        ...parsed,
        private_key: parsed.private_key.replace(/\\n/g, "\n"),
      };
    }
  } catch (e) {
    return {
      jsonParseOk: false,
      hadEscapedNewlinesInEnv: hadEscaped,
      parseError: e instanceof Error ? e.message : "invalid JSON",
    };
  }
  const pk = parsed.private_key;
  const pkStr = typeof pk === "string" ? pk : "";
  return {
    jsonParseOk: true,
    credentialType: typeof parsed.type === "string" ? parsed.type : undefined,
    clientEmail: typeof parsed.client_email === "string" ? parsed.client_email : undefined,
    projectId: typeof parsed.project_id === "string" ? parsed.project_id : undefined,
    privateKeyPresent: pkStr.length > 0,
    privateKeyLooksLikePem:
      pkStr.includes("BEGIN PRIVATE KEY") || pkStr.includes("BEGIN RSA PRIVATE KEY"),
    privateKeyCharLength: pkStr.length,
    hadEscapedNewlinesInEnv: hadEscaped,
  };
}

/**
 * Returns a copy suitable for `google-auth-library` with PEM newlines fixed.
 */
export function normalizeServiceAccountCredentials(
  credentials: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...credentials };
  if (typeof out.private_key === "string") {
    out.private_key = out.private_key.replace(/\\n/g, "\n");
  }
  return out;
}

export function parseServiceAccountJson(
  raw: string,
): { ok: true; credentials: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const credentials = JSON.parse(raw) as Record<string, unknown>;
    return { ok: true, credentials: normalizeServiceAccountCredentials(credentials) };
  } catch {
    return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON" };
  }
}
