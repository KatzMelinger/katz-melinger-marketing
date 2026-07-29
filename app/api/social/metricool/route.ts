import { NextResponse } from "next/server";

import { getSocialOverview, engagementDenominator, engagementRatePct } from "@/lib/metricool";

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

type MetricoolResponse = {
  connected: boolean;
  error?: string;
  overview: PlatformOverview[];
  posts: PostPerformance[];
  schedule: ScheduleItem[];
  trend: TrendPoint[];
  metricoolDebug?: unknown;
};

type OverviewNetwork = {
  network: PlatformName | "TikTok";
  key: string;
  followers: number | null;
  followersTrend: Array<{ date: string; value: number }>;
  posts: Array<{
    id?: string;
    content?: string;
    publishedAt?: string | null;
    likes?: number;
    comments?: number;
    shares?: number;
    impressions?: number;
    reach?: number;
  }>;
  totalPosts: number;
  totalEngagement: number;
  totalImpressions: number;
  totalReach: number;
};

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

function parseOptions(request: Request): { from?: string; to?: string } {
  const url = new URL(request.url);
  const from = url.searchParams.get("from")?.trim();
  const to = url.searchParams.get("to")?.trim();
  if (from && to) return { from, to };
  return {};
}

function asPlatform(name: string): PlatformName | null {
  if (name === "Instagram") return "Instagram";
  if (name === "Facebook") return "Facebook";
  if (name === "LinkedIn") return "LinkedIn";
  if (name === "Twitter") return "Twitter";
  return null;
}

export async function GET(request: Request) {
  const debug =
    new URL(request.url).searchParams.get("debug") === "1" ||
    process.env.METRICOOL_DEBUG === "1";

  try {
    const options = parseOptions(request);
    const data = (await getSocialOverview(options)) as OverviewNetwork[];

    const overview: PlatformOverview[] = data
      .map((row) => {
        const platform = asPlatform(row.network);
        if (!platform) return null;
        // interactions ÷ reach × 100 (impressions for LinkedIn) — matches
        // Metricool. Was dividing by impressions, which inflated the rate.
        const engagementRate = engagementRatePct(
          row.totalEngagement,
          engagementDenominator(row.key, row.totalReach, row.totalImpressions),
        );
        return {
          platform,
          followers: row.followers ?? 0,
          engagementRate,
          postsThisMonth: row.totalPosts ?? 0,
        };
      })
      .filter((x): x is PlatformOverview => x !== null);

    const posts: PostPerformance[] = data
      .flatMap((row) => {
        const platform = asPlatform(row.network);
        if (!platform) return [];
        return row.posts.map((post, index) => ({
          id: post.id ?? `${row.key}-${index}`,
          platform,
          title: (post.content ?? "Untitled post").slice(0, 200),
          publishedAt: post.publishedAt ?? new Date().toISOString(),
          impressions: post.impressions ?? 0,
          engagements: (post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0),
          clicks: 0,
        }));
      })
      .sort(
        (a, b) =>
          new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      )
      .slice(0, 12);

    // Real engagement-rate trend: bucket every post by day and compute
    // interactions ÷ reach per day (was hardcoded to 0, so the line was flat).
    const dayAgg = new Map<string, { interactions: number; denom: number }>();
    for (const row of data) {
      for (const post of row.posts) {
        const day = (post.publishedAt ?? "").slice(0, 10);
        if (!day) continue;
        const interactions = (post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0);
        const denom = engagementDenominator(row.key, post.reach ?? 0, post.impressions ?? 0);
        const cur = dayAgg.get(day) ?? { interactions: 0, denom: 0 };
        cur.interactions += interactions;
        cur.denom += denom;
        dayAgg.set(day, cur);
      }
    }
    const instagram = data.find((x) => x.key === "instagram");
    const followersByDate = new Map(
      (instagram?.followersTrend ?? []).map((p) => [p.date, p.value]),
    );
    const trend: TrendPoint[] = [...dayAgg.entries()]
      .sort((a, b) => a[0].localeCompare(b[0])) // chronological
      .map(([date, agg]) => ({
        date,
        engagementRate: engagementRatePct(agg.interactions, agg.denom),
        followers: followersByDate.get(date) ?? 0,
      }));

    const result: MetricoolResponse = {
      connected: true,
      overview,
      posts,
      schedule: [],
      trend,
    };

    if (debug) {
      return NextResponse.json({
        ...result,
        metricoolDebug: {
          options,
          networks: data,
        },
      });
    }

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const base = mockPayload(`Metricool API request failed. (${message})`);
    if (debug) {
      return NextResponse.json({
        ...base,
        metricoolDebug: { caughtError: message },
      });
    }
    return NextResponse.json(base);
  }
}
