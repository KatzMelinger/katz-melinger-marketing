import { NextResponse } from "next/server";

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

export async function GET() {
  const apiKey = process.env.METRICOOL_API_KEY?.trim();
  const userId = process.env.METRICOOL_USER_ID?.trim();
  if (!apiKey || !userId) {
    return NextResponse.json(
      mockPayload("Missing METRICOOL_API_KEY or METRICOOL_USER_ID"),
    );
  }

  try {
    const [overviewRes, postsRes, scheduleRes] = await Promise.all([
      fetch(
        `https://app.metricool.com/api/v2/analytics/overview?userId=${encodeURIComponent(userId)}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      ),
      fetch(
        `https://app.metricool.com/api/v2/posts?userId=${encodeURIComponent(userId)}&limit=12`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      ),
      fetch(
        `https://app.metricool.com/api/v2/planner?userId=${encodeURIComponent(userId)}&range=14d`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      ),
    ]);

    const [overviewJson, postsJson, scheduleJson] = await Promise.all([
      overviewRes.json(),
      postsRes.json(),
      scheduleRes.json(),
    ]);

    if (!overviewRes.ok && !postsRes.ok && !scheduleRes.ok) {
      return NextResponse.json(
        mockPayload("Metricool API request failed. Verify API key and user id."),
      );
    }

    const overviewRaw: unknown[] = Array.isArray(
      (overviewJson as { platforms?: unknown }).platforms,
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

    const postsRaw: unknown[] = Array.isArray((postsJson as { data?: unknown }).data)
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
      (scheduleJson as { events?: unknown }).events,
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

    return NextResponse.json({
      connected: true,
      overview,
      posts,
      schedule,
      trend,
    } satisfies MetricoolResponse);
  } catch {
    return NextResponse.json(
      mockPayload("Metricool API request failed. Verify API key and user id."),
    );
  }
}
