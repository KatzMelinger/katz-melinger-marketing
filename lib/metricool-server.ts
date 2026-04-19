/**
 * Metricool REST API (https://api.metricool.com/v1)
 * Auth: Bearer METRICOOL_ACCESS_TOKEN; optional METRICOOL_API_KEY if your workspace requires it.
 */

export const METRICOOL_API_BASE = "https://api.metricool.com/v1";

export type MetricoolRequestResult = {
  ok: boolean;
  status: number;
  data: unknown;
  retryAfter: string | null;
};

export function getMetricoolConfig():
  | { token: string; apiKey: string | null; error?: undefined }
  | { token?: undefined; apiKey?: undefined; error: string } {
  const token = process.env.METRICOOL_ACCESS_TOKEN?.trim();
  if (!token) {
    return { error: "Missing METRICOOL_ACCESS_TOKEN" };
  }
  const apiKey = process.env.METRICOOL_API_KEY?.trim() || null;
  return { token, apiKey };
}

export function metricoolHeaders(token: string, apiKey: string | null): HeadersInit {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (apiKey) {
    h["X-Api-Key"] = apiKey;
  }
  return h;
}

export async function metricoolFetch(
  path: string,
  init?: RequestInit,
): Promise<MetricoolRequestResult> {
  const config = getMetricoolConfig();
  if ("error" in config) {
    return {
      ok: false,
      status: 503,
      data: { error: config.error },
      retryAfter: null,
    };
  }

  const url = path.startsWith("http")
    ? path
    : `${METRICOOL_API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...metricoolHeaders(config.token, config.apiKey),
      ...(init?.headers as Record<string, string>),
    },
  });

  const retryAfter = res.headers.get("Retry-After");
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { raw: text };
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    data,
    retryAfter,
  };
}

export function metricoolErrorMessage(status: number, data: unknown): string {
  if (status === 429) {
    return "Metricool rate limit reached. Try again shortly.";
  }
  if (status === 401 || status === 403) {
    return "Metricool authentication failed. Check METRICOOL_ACCESS_TOKEN (and API key if required).";
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const msg =
      (typeof o.message === "string" && o.message) ||
      (typeof o.error === "string" && o.error) ||
      (typeof o.detail === "string" && o.detail);
    if (msg) return msg;
  }
  return `Metricool request failed (${status})`;
}
