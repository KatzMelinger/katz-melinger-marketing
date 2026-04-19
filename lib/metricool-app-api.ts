/**
 * Metricool app web API (https://app.metricool.com/api) — auth via X-Mc-Auth + userId/blogId query params.
 */

export const METRICOOL_API_BASE = "https://app.metricool.com/api";

export function maskSecret(value: string | undefined): string {
  if (value == null || value === "") return "(empty)";
  if (value.length <= 8) return `*** (len=${value.length})`;
  return `${value.slice(0, 4)}…${value.slice(-4)} (len=${value.length})`;
}

export type MetricoolEnvOk = {
  token: string;
  userId: string;
  blogId: string;
};

export type MetricoolEnvResult =
  | ({ ok: true } & MetricoolEnvOk)
  | {
      ok: false;
      error: string;
      /** Which vars were found (no secret values). */
      present: {
        METRICOOL_API_TOKEN: boolean;
        METRICOOL_USER_ID: boolean;
        METRICOOL_BLOG_ID: boolean;
      };
    };

export function readMetricoolEnv(): MetricoolEnvResult {
  const rawToken = process.env.METRICOOL_API_TOKEN;
  const rawUser = process.env.METRICOOL_USER_ID;
  const rawBlog = process.env.METRICOOL_BLOG_ID;
  const token = rawToken?.trim();
  const userId = rawUser?.trim();
  const blogId = rawBlog?.trim();

  const present = {
    METRICOOL_API_TOKEN: Boolean(token),
    METRICOOL_USER_ID: Boolean(userId),
    METRICOOL_BLOG_ID: Boolean(blogId),
  };

  if (!token || !userId || !blogId) {
    return {
      ok: false,
      error:
        "Missing METRICOOL_API_TOKEN, METRICOOL_USER_ID, or METRICOOL_BLOG_ID",
      present,
    };
  }

  return { ok: true, token, userId, blogId };
}

export function metricoolV2Url(
  path: string,
  userId: string,
  blogId: string,
  extraParams?: Record<string, string>,
): string {
  const url = new URL(
    `${METRICOOL_API_BASE}${path.startsWith("/") ? path : `/${path}`}`,
  );
  url.searchParams.set("userId", userId);
  url.searchParams.set("blogId", blogId);
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

export type MetricoolRequestLog = {
  label: string;
  url: string;
  headerKeys: string[];
  xMcAuth: string;
  status: number;
  statusText: string;
  bodyText: string;
  contentType: string | null;
};

const MAX_BODY_LOG = 8000;

export async function metricoolFetchLogged(
  label: string,
  path: string,
  token: string,
  userId: string,
  blogId: string,
  extraParams?: Record<string, string>,
): Promise<{ response: Response; log: MetricoolRequestLog }> {
  const url = metricoolV2Url(path, userId, blogId, extraParams);
  const headers: Record<string, string> = {
    "X-Mc-Auth": token,
    "Content-Type": "application/json",
  };

  console.log(`[Metricool] ${label} → request`, {
    url,
    headers: {
      ...headers,
      "X-Mc-Auth": maskSecret(token),
    },
    queryParams: Object.fromEntries(new URL(url).searchParams.entries()),
  });

  const response = await fetch(url, {
    cache: "no-store",
    headers,
  });

  const bodyText = await response.text();
  const log: MetricoolRequestLog = {
    label,
    url,
    headerKeys: Object.keys(headers),
    xMcAuth: maskSecret(token),
    status: response.status,
    statusText: response.statusText,
    bodyText:
      bodyText.length > MAX_BODY_LOG
        ? `${bodyText.slice(0, MAX_BODY_LOG)}… [truncated ${bodyText.length - MAX_BODY_LOG} chars]`
        : bodyText,
    contentType: response.headers.get("content-type"),
  };

  console.log(`[Metricool] ${label} ← response`, {
    status: log.status,
    statusText: log.statusText,
    contentType: log.contentType,
    body: log.bodyText,
  });

  const replay = new Response(bodyText, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  return { response: replay, log };
}

export function logMetricoolEnvSnapshot(): void {
  const env = readMetricoolEnv();
  if (env.ok) {
    console.log("[Metricool] env (server):", {
      METRICOOL_API_TOKEN: maskSecret(env.token),
      METRICOOL_USER_ID: env.userId,
      METRICOOL_BLOG_ID: env.blogId,
      NODE_ENV: process.env.NODE_ENV,
    });
  } else {
    console.log("[Metricool] env (server):", {
      present: env.present,
      error: env.error,
      NODE_ENV: process.env.NODE_ENV,
    });
  }
}
