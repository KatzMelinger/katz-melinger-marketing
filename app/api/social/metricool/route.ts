import { NextResponse } from "next/server";

import { getSocialOverview } from "@/lib/metricool";

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
    publishedAt?: string;
    likes?: number;
    comments?: number;
    shares?: number;
    impressions?: number;
  }>;
  totalPosts: number;
  totalEngagement: number;
  totalImpressions: number;
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
        const engagementRate =
          row.totalImpressions > 0
            ? Number(((row.totalEngagement / row.totalImpressions) * 100).toFixed(2))
            : 0;
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

    const instagram = data.find((x) => x.key === "instagram");
    const trend: TrendPoint[] = (instagram?.followersTrend ?? []).map((p) => ({
      date: p.date,
      engagementRate: 0,
      followers: p.value,
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
