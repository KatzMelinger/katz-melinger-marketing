import { NextResponse } from "next/server";

import {
  getMetricoolConfig,
  metricoolErrorMessage,
  metricoolFetch,
  METRICOOL_API_BASE,
} from "@/lib/metricool-server";

export const dynamic = "force-dynamic";

type PlatformKey = "facebook" | "linkedin" | "twitter";

function extractNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const p = Number(value);
    if (Number.isFinite(p)) return p;
  }
  return 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const r = asRecord(v);
  if (!r) return [];
  for (const key of ["data", "items", "results", "accounts", "posts", "records"]) {
    const inner = r[key];
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

function mapNetworkToKey(raw: string): PlatformKey | null {
  const n = raw.toLowerCase();
  if (n.includes("facebook") || n === "fb") return "facebook";
  if (n.includes("linkedin")) return "linkedin";
  if (n.includes("twitter") || n.includes("x.com") || n === "x") return "twitter";
  return null;
}

function networksFromPost(row: Record<string, unknown>): PlatformKey[] {
  const out: PlatformKey[] = [];
  const candidates = [
    row.network,
    row.platform,
    row.channel,
    row.socialNetwork,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      const m = mapNetworkToKey(c);
      if (m && !out.includes(m)) out.push(m);
    }
  }
  const multi = row.networks ?? row.socialNetworks ?? row.channels;
  if (Array.isArray(multi)) {
    for (const item of multi) {
      if (typeof item === "string") {
        const m = mapNetworkToKey(item);
        if (m && !out.includes(m)) out.push(m);
      } else if (item && typeof item === "object") {
        const name = (item as Record<string, unknown>).name;
        if (typeof name === "string") {
          const m = mapNetworkToKey(name);
          if (m && !out.includes(m)) out.push(m);
        }
      }
    }
  }
  if (out.length === 0) return ["linkedin"];
  return out;
}

function splitIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 16),
  };
}

function firstAccountId(accountsJson: unknown): string | null {
  const rows = asArray(accountsJson);
  for (const row of rows) {
    const r = asRecord(row);
    if (!r) continue;
    const id =
      r.id ?? r.accountId ?? r.account_id ?? r.blogId ?? r.blog_id ?? r.userId;
    if (typeof id === "string" && id.trim()) return id.trim();
    if (typeof id === "number" && Number.isFinite(id)) return String(id);
  }
  const root = asRecord(accountsJson);
  if (root) {
    const id = root.id ?? root.accountId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

function buildQuery(accountId: string | null): string {
  const qs = new URLSearchParams();
  if (accountId) qs.set("accountId", accountId);
  const blogId = process.env.METRICOOL_BLOG_ID?.trim();
  if (blogId) qs.set("blogId", blogId);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export async function GET() {
  const config = getMetricoolConfig();
  if ("error" in config) {
    return NextResponse.json(
      { error: config.error, connected: false },
      { status: 503 },
    );
  }

  const accountsRes = await metricoolFetch("/accounts");

  if (accountsRes.status === 429) {
    return NextResponse.json(
      {
        error: metricoolErrorMessage(429, accountsRes.data),
        connected: false,
        retryAfter: accountsRes.retryAfter,
      },
      {
        status: 429,
        headers: accountsRes.retryAfter
          ? { "Retry-After": accountsRes.retryAfter }
          : {},
      },
    );
  }

  if (!accountsRes.ok) {
    const status =
      accountsRes.status >= 400 && accountsRes.status < 600
        ? accountsRes.status
        : 502;
    return NextResponse.json(
      {
        error: metricoolErrorMessage(accountsRes.status, accountsRes.data),
        connected: false,
        details: accountsRes.data,
      },
      { status: status === 503 ? 503 : status },
    );
  }

  const accountId = firstAccountId(accountsRes.data);
  const q = buildQuery(accountId);

  const [postsRes, summaryRes] = await Promise.all([
    metricoolFetch(`/posts${q}`),
    metricoolFetch(`/analytics/summary${q}`),
  ]);

  if (postsRes.status === 429 || summaryRes.status === 429) {
    const r = postsRes.status === 429 ? postsRes : summaryRes;
    return NextResponse.json(
      {
        error: metricoolErrorMessage(429, r.data),
        connected: false,
        retryAfter: r.retryAfter,
      },
      {
        status: 429,
        headers: r.retryAfter ? { "Retry-After": r.retryAfter } : {},
      },
    );
  }

  const warnings: string[] = [];
  if (!accountsRes.ok) {
    warnings.push(
      `Accounts: ${metricoolErrorMessage(accountsRes.status, accountsRes.data)}`,
    );
  }
  if (!postsRes.ok) {
    warnings.push(`Posts: ${metricoolErrorMessage(postsRes.status, postsRes.data)}`);
  }
  if (!summaryRes.ok) {
    warnings.push(
      `Analytics summary: ${metricoolErrorMessage(summaryRes.status, summaryRes.data)}`,
    );
  }

  const postRows = asArray(postsRes.data);
  const summary = asRecord(summaryRes.data) ?? {};

  const scheduled: Array<{
    id: string;
    date: string;
    time: string;
    platforms: PlatformKey[];
    content: string;
    status: "scheduled" | "draft";
  }> = [];
  const queue: typeof scheduled = [];

  for (let i = 0; i < postRows.length; i++) {
    const r = asRecord(postRows[i]);
    if (!r) continue;
    const id = String(r.id ?? r.postId ?? `post-${i}`);
    const content = String(
      r.content ?? r.text ?? r.body ?? r.caption ?? r.message ?? "",
    );
    const platforms = networksFromPost(r);
    const statusRaw = String(r.status ?? r.state ?? "scheduled").toLowerCase();
    const isDraft =
      statusRaw.includes("draft") ||
      statusRaw === "pending" ||
      statusRaw === "idea";
    const when = String(
      r.scheduledAt ??
        r.scheduled_at ??
        r.publishAt ??
        r.publishedAt ??
        r.published_at ??
        r.date ??
        new Date().toISOString(),
    );
    const { date, time } = splitIso(when);
    const row = {
      id,
      date,
      time,
      platforms,
      content: content || "(No text)",
      status: isDraft ? ("draft" as const) : ("scheduled" as const),
    };
    if (isDraft) queue.push(row);
    else scheduled.push(row);
  }

  const likes = extractNumber(
    summary.likes ??
      summary.totalLikes ??
      summary.interactions ??
      summary.engagements,
  );
  const shares = extractNumber(summary.shares ?? summary.totalShares ?? summary.shareCount);
  const comments = extractNumber(
    summary.comments ?? summary.totalComments ?? summary.commentCount,
  );
  const reach = extractNumber(summary.reach ?? summary.totalReach ?? summary.audience);
  const impressions = extractNumber(
    summary.impressions ?? summary.totalImpressions ?? summary.views,
  );

  const engagementRate = extractNumber(
    summary.engagementRate ??
      summary.engagement_rate ??
      summary.er ??
      (impressions > 0 ? ((likes + shares + comments) / impressions) * 100 : 0),
  );

  const followerNow = extractNumber(
    summary.followers ?? summary.totalFollowers ?? summary.subscribers,
  );
  const followerPrev = extractNumber(
    summary.followersPrevious ??
      summary.followers_last_month ??
      summary.followers30DaysAgo,
  );
  const followerDelta30d =
    followerNow > 0 && followerPrev > 0
      ? Math.round(followerNow - followerPrev)
      : extractNumber(summary.followerGrowth ?? summary.follower_delta);

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const scheduledThisWeek = [...scheduled, ...queue].filter((p) => {
    if (!p.date) return false;
    const t = new Date(p.date + "T12:00:00");
    return t >= now && t <= weekEnd;
  }).length;

  const trendRaw = summary.trend ?? summary.timeseries ?? summary.weekly ?? summary.history;
  const trendArr = Array.isArray(trendRaw) ? trendRaw : [];

  const trend = trendArr.slice(-8).map((point, idx) => {
    const tr = asRecord(point) ?? {};
    const label =
      typeof tr.week === "string"
        ? tr.week
        : typeof tr.date === "string"
          ? String(tr.date).slice(0, 7)
          : `W${idx + 1}`;
    return {
      week: label,
      reach: extractNumber(tr.reach ?? tr.totalReach),
      impressions: extractNumber(tr.impressions ?? tr.views),
      engagementRate: extractNumber(
        tr.engagementRate ?? tr.engagement_rate ?? engagementRate,
      ),
    };
  });

  if (trend.length === 0 && (reach > 0 || impressions > 0)) {
    trend.push({
      week: now.toISOString().slice(0, 10),
      reach,
      impressions,
      engagementRate,
    });
  }

  const bestPosts = [...postRows]
    .map((row, index) => {
      const r = asRecord(row);
      if (!r) return null;
      const engagements = extractNumber(
        r.engagements ?? r.interactions ?? r.likes ?? r.totalEngagements,
      );
      const impr = extractNumber(r.impressions ?? r.views ?? r.impressionCount);
      const er = impr > 0 ? (engagements / impr) * 100 : 0;
      const platform =
        typeof r.platform === "string"
          ? r.platform
          : typeof r.network === "string"
            ? r.network
            : "Social";
      return {
        id: String(r.id ?? `bp-${index}`),
        platform,
        excerpt: String(r.content ?? r.caption ?? r.title ?? "").slice(0, 120),
        engagementRate: er,
        likes: extractNumber(r.likes),
        period: "week" as const,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.engagementRate - a.engagementRate)
    .slice(0, 10);

  const followerSeries = summary.followerHistory ?? summary.followersByDate;
  const followerGrowth = Array.isArray(followerSeries)
    ? followerSeries.slice(-8).map((pt, i) => {
        const r = asRecord(pt) ?? {};
        return {
          date: String(r.date ?? r.day ?? new Date().toISOString().slice(0, 10)),
          followers: extractNumber(r.followers ?? r.count ?? followerNow - (8 - i) * 10),
        };
      })
    : followerNow > 0
      ? [
          {
            date: new Date(now.getTime() - 28 * 864e5).toISOString().slice(0, 10),
            followers: Math.max(0, followerNow - followerDelta30d),
          },
          { date: now.toISOString().slice(0, 10), followers: followerNow },
        ]
      : [];

  const contentTypes: Array<{
    type: "text" | "image" | "video";
    posts: number;
    avgEngagementRate: number;
  }> = [];
  let textC = 0;
  let imageC = 0;
  let videoC = 0;
  for (const row of postRows) {
    const r = asRecord(row);
    if (!r) continue;
    const type = String(r.type ?? r.mediaType ?? r.format ?? "text").toLowerCase();
    if (type.includes("video")) videoC += 1;
    else if (type.includes("image") || type.includes("photo")) imageC += 1;
    else textC += 1;
  }
  const totalTyped = textC + imageC + videoC || 1;
  if (textC + imageC + videoC > 0) {
    contentTypes.push(
      {
        type: "text",
        posts: textC,
        avgEngagementRate: engagementRate * (textC / totalTyped || 1),
      },
      {
        type: "image",
        posts: imageC,
        avgEngagementRate: engagementRate * 1.1 * (imageC / totalTyped || 1),
      },
      {
        type: "video",
        posts: videoC,
        avgEngagementRate: engagementRate * 1.2 * (videoC / totalTyped || 1),
      },
    );
  }

  const hashtagsRaw = summary.topHashtags ?? summary.hashtags;
  const hashtags: Array<{ tag: string; posts: number; avgEngagement: number }> = [];
  if (Array.isArray(hashtagsRaw)) {
    for (const h of hashtagsRaw.slice(0, 12)) {
      const r = asRecord(h);
      if (!r) continue;
      hashtags.push({
        tag: String(r.tag ?? r.name ?? "#"),
        posts: extractNumber(r.posts ?? r.count),
        avgEngagement: extractNumber(r.avgEngagement ?? r.engagement ?? engagementRate),
      });
    }
  }

  const bestTimes: Array<{ platform: string; slots: string[] }> = [];
  const btr = summary.bestTimes ?? summary.optimalPostingTimes;
  if (Array.isArray(btr)) {
    for (const b of btr) {
      const r = asRecord(b);
      if (!r) continue;
      bestTimes.push({
        platform: String(r.platform ?? r.network ?? "Platform"),
        slots: Array.isArray(r.slots)
          ? r.slots.map(String)
          : typeof r.window === "string"
            ? [r.window]
            : [],
      });
    }
  }

  const calDate = new Date();
  const calendarView = {
    year: calDate.getFullYear(),
    month: calDate.getMonth(),
    label: calDate.toLocaleString(undefined, { month: "long", year: "numeric" }),
  };

  return NextResponse.json({
    connected: true,
    source: METRICOOL_API_BASE,
    warnings: warnings.length ? warnings : undefined,
    accounts: accountsRes.data,
    rawPosts: postsRes.data,
    rawSummary: summaryRes.data,
    dashboardKpis: {
      scheduledThisWeek,
      blendedEngagementRate: engagementRate,
      reach7d: extractNumber(summary.reach7d ?? summary.reachLast7Days ?? reach),
      followerDelta30d: followerDelta30d || 0,
    },
    engagement: {
      likes: likes || extractNumber(summary.totalLikes),
      shares,
      comments,
      reach,
      impressions,
    },
    scheduled,
    queue,
    trend,
    bestPosts,
    hashtags,
    bestTimes,
    contentTypes,
    followerGrowth,
    calendarView,
  });
}

export async function POST(request: Request) {
  const config = getMetricoolConfig();
  if ("error" in config) {
    return NextResponse.json({ error: config.error }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const text = typeof record.text === "string" ? record.text : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const networks = Array.isArray(record.networks)
    ? record.networks.filter((n): n is string => typeof n === "string")
    : [];

  const scheduledAt =
    typeof record.scheduledAt === "string" ? record.scheduledAt : undefined;

  const publishMode =
    typeof record.publishMode === "string" ? record.publishMode : "schedule";

  const payload: Record<string, unknown> = {
    content: text.trim(),
    text: text.trim(),
    networks,
    socialNetworks: networks,
    scheduledAt: scheduledAt ?? null,
    publishMode,
  };

  const blogId = process.env.METRICOOL_BLOG_ID?.trim();
  if (blogId) payload.blogId = blogId;

  const res = await metricoolFetch("/posts", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (res.status === 429) {
    return NextResponse.json(
      {
        error: metricoolErrorMessage(429, res.data),
        retryAfter: res.retryAfter,
        details: res.data,
      },
      {
        status: 429,
        headers: res.retryAfter ? { "Retry-After": res.retryAfter } : {},
      },
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      {
        error: metricoolErrorMessage(res.status, res.data),
        details: res.data,
      },
      { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
    );
  }

  return NextResponse.json({ success: true, data: res.data }, { status: 201 });
}
