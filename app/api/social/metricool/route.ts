import { NextResponse } from "next/server";

import {
  getPosts,
  getSocialOverview,
  getTimeline,
  readMetricoolEnv,
  timelineToTrendPoints,
  transformPostsPayload,
  type SocialNetworkSlug,
} from "@/lib/metricool";

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
  dateRange?: { from: string; to: string };
  overviewErrors?: string[];
  postsErrors?: string[];
  trendError?: string;
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

function mockPayload(error?: string): MetricoolResponse {
  const zeros: PlatformOverview[] = [
    "Facebook",
    "Instagram",
    "Twitter",
    "LinkedIn",
  ].map((platform) => ({
    platform: platform as PlatformName,
    followers: 0,
    engagementRate: 0,
    postsThisMonth: 0,
  }));
  return {
    connected: false,
    error,
    overview: zeros,
    posts: [],
    schedule: [],
    trend: [],
  };
}

function utcDayBoundary(daysBack: number): { from: string; to: string } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - daysBack);
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: `${isoDate(start)}T00:00:00.000Z`,
    to: `${isoDate(end)}T23:59:59.999Z`,
  };
}

function parseRange(request: Request): { from: string; to: string } {
  const url = new URL(request.url);
  const from = url.searchParams.get("from")?.trim();
  const to = url.searchParams.get("to")?.trim();
  if (from && to) {
    return {
      from: from.includes("T") ? from : `${from}T00:00:00.000Z`,
      to: to.includes("T") ? to : `${to}T23:59:59.999Z`,
    };
  }
  return utcDayBoundary(30);
}

const POST_NETWORKS: SocialNetworkSlug[] = [
  "instagram",
  "facebook",
  "linkedin",
  "twitter",
];

export async function GET(request: Request) {
  const debug =
    new URL(request.url).searchParams.get("debug") === "1" ||
    process.env.METRICOOL_DEBUG === "1";

  const env = readMetricoolEnv();
  if (!env.ok) {
    const base = mockPayload(env.error);
    if (debug) {
      return NextResponse.json({
        ...base,
        metricoolDebug: {
          present: env.present,
          hint:
            "Set METRICOOL_API_TOKEN, METRICOOL_USER_ID, METRICOOL_BLOG_ID in the server environment (.env.local). Restart Next.js after changes.",
        },
      } satisfies MetricoolResponse);
    }
    return NextResponse.json(base);
  }

  const { token, userId, blogId } = env;
  const range = parseRange(request);
  const timezone =
    new URL(request.url).searchParams.get("timezone")?.trim() ||
    process.env.METRICOOL_TIMEZONE?.trim() ||
    undefined;

  try {
    const overviewRows = await getSocialOverview(token, userId, blogId, {
      ...range,
      timezone,
    });

    const overview: PlatformOverview[] = overviewRows.map((row) => ({
      platform: row.network === "instagram"
        ? "Instagram"
        : row.network === "twitter"
          ? "Twitter"
          : row.network === "linkedin"
            ? "LinkedIn"
            : "Facebook",
      followers: row.followers,
      engagementRate: row.engagementRate,
      postsThisMonth: row.postsThisMonth,
    }));

    const postsResults = await Promise.all(
      POST_NETWORKS.map(async (network) => {
        const res = await getPosts(token, userId, blogId, {
          network,
          metric: "impressions",
          subject: "posts",
          from: range.from,
          to: range.to,
          timezone,
        });
        const text = await res.text();
        let json: unknown = null;
        try {
          json = text ? (JSON.parse(text) as unknown) : null;
        } catch {
          json = { _parseError: true as const, raw: text };
        }
        return { network, ok: res.ok, status: res.status, json };
      }),
    );

    const posts: PostPerformance[] = [];
    const postsErrors: string[] = [];
    for (const r of postsResults) {
      if (!r.ok) {
        postsErrors.push(`${r.network}: HTTP ${r.status}`);
        continue;
      }
      posts.push(...transformPostsPayload(r.network, r.json));
    }
    posts.sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
    const postsTop = posts.slice(0, 12);

    let trend: TrendPoint[] = [];
    let trendError: string | undefined;
    try {
      const opts = { from: range.from, to: range.to, timezone };
      const [engData, folData] = await Promise.all([
        getTimeline("instagram", "engagement", "posts", opts),
        getTimeline("instagram", "followers", "account", opts),
      ]);
      trend = timelineToTrendPoints(engData, folData);
    } catch (e) {
      trendError = e instanceof Error ? e.message : String(e);
    }

    const overviewErrors = overviewRows
      .map((row) => {
        const raw = row.raw?.accountTimeline;
        if (raw && typeof raw === "object" && "error" in (raw as object)) {
          return `${row.network}: ${String((raw as { error?: unknown }).error)}`;
        }
        return null;
      })
      .filter((x): x is string => Boolean(x));

    const allPostsAuthDenied = postsResults.every(
      (r) => r.status === 401 || r.status === 403,
    );
    if (allPostsAuthDenied) {
      const base = mockPayload(
        "Metricool authentication failed. Verify METRICOOL_API_TOKEN and that userId/blogId match your Metricool workspace.",
      );
      if (debug) {
        return NextResponse.json({
          ...base,
          metricoolDebug: {
            dateRange: range,
            postsErrors,
            trendError,
          },
        } satisfies MetricoolResponse);
      }
      return NextResponse.json(base);
    }

    const success: MetricoolResponse = {
      connected: true,
      overview,
      posts: postsTop,
      schedule: [],
      trend,
    };

    if (debug) {
      return NextResponse.json({
        ...success,
        metricoolDebug: {
          dateRange: range,
          overviewErrors: overviewErrors.length ? overviewErrors : undefined,
          postsErrors: postsErrors.length ? postsErrors : undefined,
          trendError,
        },
      });
    }

    return NextResponse.json(success);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const base = mockPayload(
      `Metricool API request failed. (${message})`,
    );
    if (debug) {
      return NextResponse.json({
        ...base,
        metricoolDebug: {
          caughtError: message,
          dateRange: parseRange(request),
        },
      } satisfies MetricoolResponse);
    }
    return NextResponse.json(base);
  }
}
