/**
 * GET /api/social/kpi  — Screen 2 (KPI Tracker)
 *
 * Aggregates Metricool's last-30-day analytics into the summary cards + a
 * per-channel breakdown. Built on getSocialOverview (followers + post
 * aggregates per network), extended with saves/views so each channel can show
 * its channel-specific metric (IG saves, TikTok shares, etc.).
 *
 * Note: profile clicks / website clicks are not exposed by the Metricool post
 * analytics endpoints, so those are reported as null and the UI labels them
 * "not available" rather than inventing a number.
 */

import { NextResponse } from "next/server";

import { getSocialOverview } from "@/lib/metricool";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OverviewNetwork = {
  network: string;
  key: string;
  followers: number | null;
  totalPosts: number;
  totalEngagement: number;
  totalImpressions: number;
  totalReach: number;
  totalShares: number;
  totalSaved: number;
  totalViews: number;
};

function rate(engagement: number, reachOrImpr: number): number {
  return reachOrImpr > 0 ? Number(((engagement / reachOrImpr) * 100).toFixed(2)) : 0;
}

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  try {
    const data = (await getSocialOverview()) as OverviewNetwork[];

    const channels = data.map((n) => {
      const base = n.totalReach > 0 ? n.totalReach : n.totalImpressions;
      return {
        network: n.network,
        key: n.key,
        followers: n.followers ?? 0,
        reach: n.totalReach,
        impressions: n.totalImpressions,
        engagement: n.totalEngagement,
        engagementRate: rate(n.totalEngagement, base),
        posts: n.totalPosts,
        saved: n.totalSaved,
        shares: n.totalShares,
        views: n.totalViews,
      };
    });

    const totalReach = channels.reduce((s, c) => s + c.reach, 0);
    const totalImpressions = channels.reduce((s, c) => s + c.impressions, 0);
    const totalEngagement = channels.reduce((s, c) => s + c.engagement, 0);
    const totalFollowers = channels.reduce((s, c) => s + c.followers, 0);
    const totalPosts = channels.reduce((s, c) => s + c.posts, 0);

    return NextResponse.json({
      connected: true,
      summary: {
        totalReach,
        totalImpressions,
        totalEngagement,
        totalFollowers,
        totalPosts,
        engagementRate: rate(totalEngagement, totalReach > 0 ? totalReach : totalImpressions),
        // Not exposed by Metricool's post analytics API:
        profileClicks: null as number | null,
        websiteClicks: null as number | null,
      },
      channels,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ connected: false, error: message, channels: [] });
  }
}
