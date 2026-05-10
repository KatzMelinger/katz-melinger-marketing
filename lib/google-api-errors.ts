/**
 * Google JSON error format: https://cloud.google.com/apis/design/errors
 */

export type GoogleApiErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: unknown;
    errors?: Array<{ domain?: string; reason?: string; message?: string }>;
  };
};

export type ParsedGoogleApiError = {
  httpStatus: number;
  httpStatusText: string;
  message: string;
  googleCode?: number;
  googleStatus?: string;
  details?: unknown;
  errors?: Array<{ domain?: string; reason?: string; message?: string }>;
  rawBody: string;
};

export function parseGoogleApiErrorJson(
  httpStatus: number,
  httpStatusText: string,
  bodyText: string,
): ParsedGoogleApiError {
  let message = httpStatusText || "Request failed";
  let googleCode: number | undefined;
  let googleStatus: string | undefined;
  let details: unknown;
  let errors: ParsedGoogleApiError["errors"];

  if (bodyText.trim()) {
    try {
      const j = JSON.parse(bodyText) as GoogleApiErrorPayload;
      const err = j?.error;
      if (err?.message) message = err.message;
      googleCode = err?.code;
      googleStatus = err?.status;
      details = err?.details;
      errors = err?.errors;
    } catch {
      // Non-JSON response — Google's edge layer sometimes returns the
      // generic HTML 404 / 502 page instead of a JSON envelope. Strip
      // markup so the UI doesn't render a wall of HTML; surface only the
      // meaningful sentence (the <title> tag).
      const titleMatch = bodyText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const stripped = titleMatch?.[1]?.trim() ?? bodyText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      message = stripped.slice(0, 300) || `HTTP ${httpStatus}`;
    }
  }

  return {
    httpStatus,
    httpStatusText,
    message,
    googleCode,
    googleStatus,
    details,
    errors,
    rawBody: bodyText.length > 4000 ? `${bodyText.slice(0, 4000)}…` : bodyText,
  };
}

export async function parseGoogleApiErrorResponse(
  res: Response,
): Promise<ParsedGoogleApiError> {
  const text = await res.text();
  return parseGoogleApiErrorJson(res.status, res.statusText, text);
}
