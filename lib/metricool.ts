/**
 * Metricool app API — https://app.metricool.com/api
 * Auth: header X-Mc-Auth (user token) + query userId & blogId on every request.
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
      present: {
        METRICOOL_API_TOKEN: boolean;
        METRICOOL_USER_ID: boolean;
        METRICOOL_BLOG_ID: boolean;
      };
    };

export function readMetricoolEnv(): MetricoolEnvResult {
  const token = process.env.METRICOOL_API_TOKEN?.trim();
  const userId = process.env.METRICOOL_USER_ID?.trim();
  const blogId = process.env.METRICOOL_BLOG_ID?.trim();

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

export type MetricoolAnalyticsParams = {
  network: string;
  metric: string;
  subject: string;
  from: string;
  to: string;
  /** IANA zone, e.g. Europe/Madrid — defaults to METRICOOL_TIMEZONE or UTC */
  timezone?: string;
};

/**
 * Low-level GET to the Metricool app API (Replit-style).
 * Always sends X-Mc-Auth and merges userId/blogId into the query string.
 */
export async function metricoolFetch(
  path: string,
  token: string,
  userId: string,
  blogId: string,
  query?: Record<string, string | undefined>,
): Promise<Response> {
  const basePath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${METRICOOL_API_BASE}${basePath}`);
  url.searchParams.set("userId", userId);
  url.searchParams.set("blogId", blogId);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }

  return fetch(url.toString(), {
    cache: "no-store",
    headers: {
      "X-Mc-Auth": token,
      "Content-Type": "application/json",
    },
  });
}

function analyticsTimezone(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.METRICOOL_TIMEZONE?.trim() ||
    "UTC"
  );
}

/**
 * Build query params for /v2/analytics/timelines (aligned with metricool/mcp-metricool branching).
 */
export function timelinesQuery(
  params: MetricoolAnalyticsParams,
): Record<string, string> {
  const tz = analyticsTimezone(params.timezone);
  const { network, metric, subject, from, to } = params;
  const base: Record<string, string> = {
    from,
    to,
    timezone: tz,
    metric,
    network,
  };

  if (network === "linkedin" && subject !== "stories") {
    return { ...base, metricType: subject };
  }
  if (network === "tiktok" && subject === "videos") {
    return base;
  }
  if (network === "youtube" && subject === "videos") {
    return { ...base, postsType: "publishedInRange" };
  }
  return { ...base, subject };
}

export async function getTimeline(
  token: string,
  userId: string,
  blogId: string,
  params: MetricoolAnalyticsParams,
): Promise<Response> {
  return metricoolFetch(
    "/v2/analytics/timelines",
    token,
    userId,
    blogId,
    timelinesQuery(params),
  );
}

export async function getPosts(
  token: string,
  userId: string,
  blogId: string,
  params: MetricoolAnalyticsParams,
): Promise<Response> {
  const network = encodeURIComponent(params.network);
  const tz = analyticsTimezone(params.timezone);
  return metricoolFetch(`/v2/analytics/posts/${network}`, token, userId, blogId, {
    from: params.from,
    to: params.to,
    metric: params.metric,
    subject: params.subject,
    timezone: tz,
  });
}

export type SocialNetworkSlug =
  | "facebook"
  | "instagram"
  | "twitter"
  | "linkedin";

export type SocialOverviewRow = {
  network: SocialNetworkSlug;
  followers: number;
  engagementRate: number;
  postsThisMonth: number;
  /** Last timeline points used for the row (for debugging) */
  raw?: {
    accountTimeline?: unknown;
    postsEngagementTimeline?: unknown;
    postsCountTimeline?: unknown;
  };
};

function extractNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Last numeric point across timeline payload shapes used by Metricool. */
export function lastSeriesValue(json: unknown): number {
  if (!json || typeof json !== "object") return 0;
  const o = json as Record<string, unknown>;
  const data = o.data;
  if (!Array.isArray(data) || data.length === 0) return 0;
  const first = data[0];
  if (!first || typeof first !== "object") return 0;
  const values = (first as Record<string, unknown>).values;
  if (!Array.isArray(values) || values.length === 0) return 0;
  const last = values[values.length - 1];
  if (!last || typeof last !== "object") return 0;
  const row = last as Record<string, unknown>;
  const candidates = [
    row.value,
    row.count,
    row.y,
    row.metric,
    row.total,
  ];
  for (const c of candidates) {
    const n = extractNumber(c);
    if (n !== 0) return n;
  }
  return 0;
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _parseError: true as const, raw: text };
  }
}

const OVERVIEW_NETWORKS: {
  network: SocialNetworkSlug;
  accountMetric: string;
  postsEngagementMetric: string;
}[] = [
  { network: "facebook", accountMetric: "pageFollows", postsEngagementMetric: "engagement" },
  { network: "instagram", accountMetric: "followers", postsEngagementMetric: "engagement" },
  { network: "twitter", accountMetric: "twitterFollowers", postsEngagementMetric: "engagement" },
  { network: "linkedin", accountMetric: "followers", postsEngagementMetric: "engagement" },
];

/**
 * Parallel v2 timeline reads per network (account followers, posts engagement, posts count).
 */
export async function getSocialOverview(
  token: string,
  userId: string,
  blogId: string,
  range: { from: string; to: string; timezone?: string },
): Promise<SocialOverviewRow[]> {
  const { from, to, timezone } = range;

  const tasks = OVERVIEW_NETWORKS.map(async (spec) => {
    const common = { from, to, timezone, network: spec.network };
    const [accountRes, engRes, countRes] = await Promise.all([
      getTimeline(token, userId, blogId, {
        ...common,
        metric: spec.accountMetric,
        subject: "account",
      }),
      getTimeline(token, userId, blogId, {
        ...common,
        metric: spec.postsEngagementMetric,
        subject: "posts",
      }),
      getTimeline(token, userId, blogId, {
        ...common,
        metric: "count",
        subject: "posts",
      }),
    ]);

    const [accountJson, engJson, countJson] = await Promise.all([
      parseJson(accountRes),
      parseJson(engRes),
      parseJson(countRes),
    ]);

    return {
      network: spec.network,
      followers: lastSeriesValue(accountJson),
      engagementRate: lastSeriesValue(engJson),
      postsThisMonth: Math.round(lastSeriesValue(countJson)),
      raw: {
        accountTimeline: accountJson,
        postsEngagementTimeline: engJson,
        postsCountTimeline: countJson,
      },
    } satisfies SocialOverviewRow;
  });

  return Promise.all(tasks);
}

function normalizePlatformLabel(
  network: SocialNetworkSlug,
): "Facebook" | "Instagram" | "Twitter" | "LinkedIn" {
  switch (network) {
    case "instagram":
      return "Instagram";
    case "twitter":
      return "Twitter";
    case "linkedin":
      return "LinkedIn";
    default:
      return "Facebook";
  }
}

type PostPerformance = {
  id: string;
  platform: "Facebook" | "Instagram" | "Twitter" | "LinkedIn";
  title: string;
  publishedAt: string;
  impressions: number;
  engagements: number;
  clicks: number;
};

function toIsoDate(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/** Normalize /v2/analytics/posts/{network} payloads into dashboard post rows. */
export type TrendPoint = {
  date: string;
  engagementRate: number;
  followers: number;
};

export function timelineToTrendPoints(
  engagementTimeline: unknown,
  followersTimeline: unknown,
): TrendPoint[] {
  const eng = timelineValueSeries(engagementTimeline);
  const fol = timelineValueSeries(followersTimeline);
  const byDate = new Map<string, { e?: number; f?: number }>();
  for (const p of eng) {
    const d = p.date.slice(0, 10);
    const cur = byDate.get(d) ?? {};
    cur.e = p.value;
    byDate.set(d, cur);
  }
  for (const p of fol) {
    const d = p.date.slice(0, 10);
    const cur = byDate.get(d) ?? {};
    cur.f = p.value;
    byDate.set(d, cur);
  }
  const dates = [...byDate.keys()].sort();
  return dates.map((date) => {
    const row = byDate.get(date) ?? {};
    return {
      date,
      engagementRate: row.e ?? 0,
      followers: row.f ?? 0,
    };
  });
}

function timelineValueSeries(
  json: unknown,
): { date: string; value: number }[] {
  if (!json || typeof json !== "object") return [];
  const data = (json as { data?: unknown[] }).data;
  if (!Array.isArray(data) || data.length === 0) return [];
  const first = data[0];
  if (!first || typeof first !== "object") return [];
  const values = (first as Record<string, unknown>).values;
  if (!Array.isArray(values)) return [];
  const out: { date: string; value: number }[] = [];
  for (const v of values) {
    if (!v || typeof v !== "object") continue;
    const row = v as Record<string, unknown>;
    const dt =
      typeof row.dateTime === "string"
        ? row.dateTime
        : typeof row.date === "string"
          ? row.date
          : "";
    if (!dt) continue;
    const value = extractNumber(
      row.value ?? row.y ?? row.count ?? row.metric,
    );
    out.push({ date: dt, value });
  }
  return out;
}

export function transformPostsPayload(
  network: SocialNetworkSlug,
  json: unknown,
): PostPerformance[] {
  const platform = normalizePlatformLabel(network);
  const candidates: unknown[] = [];

  if (Array.isArray(json)) {
    candidates.push(...json);
  } else if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.data)) candidates.push(...o.data);
    if (Array.isArray(o.posts)) candidates.push(...o.posts);
    if (Array.isArray(o.items)) candidates.push(...o.items);
    if (Array.isArray(o.results)) candidates.push(...o.results);
  }

  return candidates.slice(0, 24).map((row, index) => {
    const src = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const id = String(
      src.id ?? src.postId ?? src.uuid ?? `${platform}-${index}`,
    );
    return {
      id,
      platform,
      title: String(
        src.caption ?? src.title ?? src.text ?? src.message ?? "Untitled post",
      ),
      publishedAt: toIsoDate(
        src.publishedAt ?? src.date ?? src.createdTime ?? src.timestamp,
      ),
      impressions: extractNumber(
        src.impressions ?? src.impressionsunique ?? src.impression,
      ),
      engagements: extractNumber(
        src.engagements ??
          src.interactions ??
          src.engagement ??
          src.likes,
      ),
      clicks: extractNumber(src.clicks ?? src.linkClicks ?? src.clicksCount),
    };
  });
}
