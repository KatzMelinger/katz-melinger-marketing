/**
 * Social Ops Hub — owned + earned reach.
 *
 * Landing page that aggregates social media, community, and reviews
 * into a single router. Detailed Metricool analytics live at
 * /social/analytics. Sub-area cards link out to existing pages.
 */

import type { Metadata } from "next";

import { HubShell, type HubCard, type HubKpi } from "@/components/hub-shell";
import { getRequestOrigin } from "@/lib/request-origin";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { APP_NAME } from "@/lib/app-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Social Ops Hub | ${APP_NAME}`,
  description:
    "Social media performance, community management, and reviews.",
};

async function fetchJsonSafe<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type MetricoolOverview = {
  connected: boolean;
  overview?: Array<{
    platform: string;
    followers: number;
    engagementRate: number;
    postsThisMonth: number;
  }>;
};

async function fetchReviewsSnapshot(): Promise<{
  totalReviews: number;
  googleAvg: number | null;
  reviewsThisMonth: number;
} | null> {
  try {
    const sb = getSupabaseServer();
    if (!sb) return null;
    const { data, error } = await sb
      .from("reviews")
      .select("platform, rating, review_date, created_at")
      .eq("tenant_id", await resolveTenantId());
    if (error || !data) return null;
    const rows = data as Array<{
      platform?: string;
      rating?: number;
      review_date?: string;
      created_at?: string;
    }>;
    const google = rows.filter((r) =>
      String(r.platform ?? "").toLowerCase().includes("google"),
    );
    const googleAvg =
      google.length > 0
        ? google.reduce((s, r) => s + (Number(r.rating) || 0), 0) / google.length
        : null;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const reviewsThisMonth = rows.filter((r) => {
      const d = r.review_date
        ? new Date(r.review_date)
        : r.created_at
          ? new Date(r.created_at)
          : null;
      return d && !Number.isNaN(d.getTime()) && d >= monthStart;
    }).length;
    return { totalReviews: rows.length, googleAvg, reviewsThisMonth };
  } catch {
    return null;
  }
}

export default async function SocialHubPage() {
  const base = await getRequestOrigin();

  const [metricool, reviews] = await Promise.all([
    fetchJsonSafe<MetricoolOverview>(`${base}/api/social/metricool`),
    fetchReviewsSnapshot(),
  ]);

  const totalFollowers =
    metricool?.overview?.reduce((s, r) => s + (r.followers ?? 0), 0) ?? 0;
  const totalPostsThisMonth =
    metricool?.overview?.reduce((s, r) => s + (r.postsThisMonth ?? 0), 0) ?? 0;
  const avgEngagement =
    metricool?.overview && metricool.overview.length > 0
      ? metricool.overview.reduce((s, r) => s + (r.engagementRate ?? 0), 0) /
        metricool.overview.length
      : null;

  const kpis: HubKpi[] = [
    {
      label: "Followers (all platforms)",
      value: totalFollowers > 0 ? totalFollowers.toLocaleString() : "—",
      hint: "Metricool aggregate",
      tone: totalFollowers > 0 ? "blue" : "neutral",
    },
    {
      label: "Posts this month",
      value: totalPostsThisMonth.toString(),
      hint: "Across all platforms",
      tone: "neutral",
    },
    {
      label: "Avg engagement",
      value: avgEngagement != null ? `${avgEngagement.toFixed(2)}%` : "—",
      hint: "Across all platforms",
      tone: avgEngagement != null && avgEngagement >= 2 ? "emerald" : "neutral",
    },
    {
      label: "Google reviews",
      value:
        reviews?.googleAvg != null
          ? `${reviews.googleAvg.toFixed(1)}★`
          : "—",
      hint: reviews ? `${reviews.totalReviews} total · +${reviews.reviewsThisMonth} this month` : "",
      tone: reviews?.googleAvg != null && reviews.googleAvg >= 4.5 ? "emerald" : "amber",
    },
  ];

  const cards: HubCard[] = [
    {
      href: "/social/analytics",
      label: "Social Media Analytics",
      description:
        "Metricool-backed dashboard for follower counts, engagement, posts, and scheduling.",
      metric:
        metricool?.connected
          ? `${totalFollowers.toLocaleString()} followers`
          : "Configure Metricool",
    },
    {
      href: "/social/trends",
      label: "Trends & Playbooks",
      description:
        "What's trending in NY/NJ employment law right now, plus per-platform playbooks (hashtags, hooks, captions) for LinkedIn, Instagram, TikTok, Facebook.",
      metric: "AI-generated",
    },
    {
      href: "/community",
      label: "Community Status",
      description:
        "Track community channels — Reddit, YouTube, niche forums — where the firm participates.",
    },
    {
      href: "/reviews",
      label: "Reviews",
      description:
        "Google and third-party review aggregation, response tracking, and rating snapshot.",
      metric: reviews
        ? `${reviews.totalReviews} total`
        : "—",
    },
    {
      href: "/local-seo",
      label: "Local SEO + GBP",
      description:
        "Google Business Profile presence, local pack rankings, and neighborhood-level visibility.",
    },
    {
      href: "/content",
      label: "Content Studio",
      description:
        "Generate social posts, blogs, and email content from one place — feeds Metricool scheduling.",
    },
    {
      href: "/brand-voice",
      label: "Brand Voice",
      description:
        "The voice and tone rules every social post and content draft is checked against.",
    },
  ];

  return (
    <HubShell
      eyebrow="Social Ops Hub"
      title="Owned + earned reach"
      subtitle="Social media performance, community engagement, and reputation management — the channels where the firm shows up beyond paid + organic search."
      kpis={kpis}
      cards={cards}
      actions={[
        { href: "/social/analytics", label: "Open analytics", variant: "outline" },
        { href: "/content", label: "Create post", variant: "primary" },
      ]}
    />
  );
}
