import { NextResponse } from "next/server";

import {
  logMetricoolEnvSnapshot,
  metricoolFetchLogged,
  readMetricoolEnv,
  type MetricoolRequestLog,
} from "@/lib/metricool-app-api";

export const dynamic = "force-dynamic";

type PlatformName = "Facebook" | "Instagram" | "Twitter" | "LinkedIn";

type PlatformOverview = {
  platform: PlatformName;
  followers: number;
  engagementRate: number;
  postsThisMonth: number;
};

type PostPerformance = {
  id: string;
  platform: PlatformName;
  title: string;
  publishedAt: string;
  impressions: number;
  engagements: number;
  clicks: number;
};

type ScheduleItem = {
  id: string;
  platform: PlatformName;
  date: string;
  status: "scheduled" | "draft";
  content: string;
};

type TrendPoint = {
  date: string;
  engagementRate: number;
  followers: number;
};

type MetricoolDebugPayload = {
  present?: {
    METRICOOL_API_TOKEN: boolean;
    METRICOOL_USER_ID: boolean;
    METRICOOL_BLOG_ID: boolean;
  };
  hint?: string;
  requests?: MetricoolRequestLog[];
  caughtError?: string;
};

type MetricoolResponse = {
  connected: boolean;
  error?: string;
  overview: PlatformOverview[];
  posts: PostPerformance[];
  schedule: ScheduleItem[];
  trend: TrendPoint[];
  metricoolDebug?: MetricoolDebugPayload;
};

const PLATFORMS: PlatformName[] = [
  "Facebook",
  "Instagram",
  "Twitter",
  "LinkedIn",
];

function mockPayload(error?: string): MetricoolResponse {
  return {
    connected: false,
    error,
    overview: [
      {
        platform: "Facebook",
        followers: 0,
        engagementRate: 0,
        postsThisMonth: 0,
      },
      {
        platform: "Instagram",
        followers: 0,
        engagementRate: 0,
        postsThisMonth: 0,
      },
      {
        platform: "Twitter",
        followers: 0,
        engagementRate: 0,
        postsThisMonth: 0,
      },
      {
        platform: "LinkedIn",
        followers: 0,
        engagementRate: 0,
        postsThisMonth: 0,
      },
    ],
    posts: [],
    schedule: [],
    trend: [],
  };
}

function extractNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizePlatform(value: string): PlatformName {
  const normalized = value.toLowerCase();
  if (normalized.includes("insta")) return "Instagram";
  if (normalized.includes("twitter") || normalized.includes("x")) return "Twitter";
  if (normalized.includes("linkedin")) return "LinkedIn";
  return "Facebook";
}

function toIsoDate(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _parseError: true as const, raw: text };
  }
}

export async function GET(request: Request) {
  const debug =
    new URL(request.url).searchParams.get("debug") === "1" ||
    process.env.METRICOOL_DEBUG === "1";

  console.log("[Metricool] GET /api/social/metricool", { debug });
  logMetricoolEnvSnapshot();

  const env = readMetricoolEnv();
  if (!env.ok) {
    console.error("[Metricool] missing env:", env.present);
    const base = mockPayload(env.error);
    if (debug) {
      return NextResponse.json({
        ...base,
        metricoolDebug: {
          present: env.present,
          hint:
            "Vars must be available to the Node server (e.g. .env.local). Restart `next dev` after changes.",
        },
      } satisfies MetricoolResponse);
    }
    return NextResponse.json(base);
  }

  const { token, userId, blogId } = env;

  try {
    const [overviewR, postsR, scheduleR] = await Promise.all([
      metricoolFetchLogged(
        "overview",
        "/v2/analytics/overview",
        token,
        userId,
        blogId,
      ),
      metricoolFetchLogged("posts", "/v2/posts", token, userId, blogId, {
        limit: "12",
      }),
      metricoolFetchLogged("planner", "/v2/planner", token, userId, blogId, {
        range: "14d",
      }),
    ]);

    const [overviewRes, postsRes, scheduleRes] = [
      overviewR.response,
      postsR.response,
      scheduleR.response,
    ];

    const [overviewJson, postsJson, scheduleJson] = await Promise.all([
      safeJson(overviewRes),
      safeJson(postsRes),
      safeJson(scheduleRes),
    ]);

    const logs = [overviewR.log, postsR.log, scheduleR.log];

    const authFailed = [overviewRes, postsRes, scheduleRes].some(
      (r) => r.status === 401 || r.status === 403,
    );
    if (authFailed) {
      const msg =
        "Metricool authentication failed. Verify METRICOOL_API_TOKEN and that userId/blogId match your Metricool workspace.";
      const base = mockPayload(msg);
      console.error("[Metricool] auth failed", {
        statuses: logs.map((l) => l.status),
      });
      if (debug) {
        return NextResponse.json({
          ...base,
          metricoolDebug: { requests: logs },
        } satisfies MetricoolResponse);
      }
      return NextResponse.json(base);
    }

    if (!overviewRes.ok && !postsRes.ok && !scheduleRes.ok) {
      const base = mockPayload(
        "Metricool API request failed. Verify METRICOOL_API_TOKEN, METRICOOL_USER_ID, and METRICOOL_BLOG_ID.",
      );
      console.error("[Metricool] all endpoints failed", {
        statuses: logs.map((l) => ({ label: l.label, status: l.status })),
      });
      if (debug) {
        return NextResponse.json({
          ...base,
          metricoolDebug: { requests: logs },
        } satisfies MetricoolResponse);
      }
      return NextResponse.json(base);
    }

    const overviewRaw: unknown[] = Array.isArray(
      (overviewJson as { platforms?: unknown })?.platforms,
    )
      ? ((overviewJson as { platforms?: unknown[] }).platforms ?? [])
      : [];
    const overviewMap = new Map<PlatformName, PlatformOverview>();
    for (const p of PLATFORMS) {
      overviewMap.set(p, {
        platform: p,
        followers: 0,
        engagementRate: 0,
        postsThisMonth: 0,
      });
    }
    for (const row of overviewRaw) {
      if (!row || typeof row !== "object") continue;
      const src = row as Record<string, unknown>;
      const platform = normalizePlatform(String(src.platform ?? "facebook"));
      overviewMap.set(platform, {
        platform,
        followers: extractNumber(src.followers),
        engagementRate: extractNumber(src.engagementRate),
        postsThisMonth: extractNumber(src.posts),
      });
    }
    const overview = [...overviewMap.values()];

    const postsRaw: unknown[] = Array.isArray(
      (postsJson as { data?: unknown })?.data,
    )
      ? ((postsJson as { data?: unknown[] }).data ?? [])
      : [];
    const posts: PostPerformance[] = postsRaw.slice(0, 12).map((row, index) => {
      const src = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const id = String(src.id ?? `post-${index}`);
      return {
        id,
        platform: normalizePlatform(String(src.platform ?? "facebook")),
        title: String(src.caption ?? src.title ?? "Untitled post"),
        publishedAt: toIsoDate(src.publishedAt ?? src.date),
        impressions: extractNumber(src.impressions),
        engagements: extractNumber(src.engagements ?? src.interactions),
        clicks: extractNumber(src.clicks),
      };
    });

    const scheduleRaw: unknown[] = Array.isArray(
      (scheduleJson as { events?: unknown })?.events,
    )
      ? ((scheduleJson as { events?: unknown[] }).events ?? [])
      : [];
    const schedule: ScheduleItem[] = scheduleRaw.slice(0, 12).map((row, index) => {
      const src = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return {
        id: String(src.id ?? `schedule-${index}`),
        platform: normalizePlatform(String(src.platform ?? "facebook")),
        date: toIsoDate(src.date ?? src.scheduledAt),
        status: String(src.status ?? "scheduled").toLowerCase() === "draft"
          ? "draft"
          : "scheduled",
        content: String(src.content ?? src.caption ?? "Scheduled social post"),
      };
    });

    const trend = posts
      .slice(0, 7)
      .reverse()
      .map((post, idx): TrendPoint => ({
        date: post.publishedAt.slice(0, 10),
        engagementRate:
          post.impressions > 0
            ? Number(((post.engagements / post.impressions) * 100).toFixed(2))
            : 0,
        followers: overview.reduce((sum, item) => sum + item.followers, 0) + idx * 5,
      }));

    const success = {
      connected: true,
      overview,
      posts,
      schedule,
      trend,
    } satisfies MetricoolResponse;

    if (debug) {
      console.log("[Metricool] success; attaching debug request logs");
      return NextResponse.json({
        ...success,
        metricoolDebug: { requests: logs },
      });
    }

    return NextResponse.json(success);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Metricool] GET handler error:", e);
    const base = mockPayload(
      `Metricool API request failed. Verify METRICOOL_API_TOKEN, METRICOOL_USER_ID, and METRICOOL_BLOG_ID. (${message})`,
    );
    if (debug) {
      return NextResponse.json({
        ...base,
        metricoolDebug: { caughtError: message },
      } satisfies MetricoolResponse);
    }
    return NextResponse.json(base);
  }
}
