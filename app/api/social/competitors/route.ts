/**
 * GET /api/social/competitors  — Screen 6 (Competitor Social Tracking)
 *
 * Reads competitor accounts tracked in Metricool (Settings → Competitors) for
 * Instagram + LinkedIn, plus our own stats for the head-to-head comparison.
 *
 * The competitor endpoint returns [] until handles are added in Metricool, so
 * the normalizer is defensive about field names (Metricool's exact competitor
 * shape isn't documented) and passes through `raw` for anything unmapped.
 */

import { NextResponse } from "next/server";

import { getCompetitors, getSocialOverview } from "@/lib/metricool";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Raw = Record<string, unknown>;

function num(...vals: unknown[]): number {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}
function str(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

function normalize(c: Raw, network: string) {
  const followers = num(c.followers, c.fans, c.followersCount, c.community);
  const posts = num(c.posts, c.postsCount, c.numberOfPosts);
  const engagement = num(c.engagement, c.engagementRate, c.avgEngagement);
  return {
    network,
    name: str(c.name, c.title, c.username, c.handle, c.label) || "Unknown",
    username: str(c.username, c.handle, c.screenName),
    picture: str(c.picture, c.image, c.avatar) || null,
    followers,
    posts,
    engagementRate: engagement <= 1 ? Number((engagement * 100).toFixed(2)) : Number(engagement.toFixed(2)),
    topFormat: str(c.topFormat, c.bestFormat, c.mainType) || null,
    raw: c,
  };
}

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  try {
    const [igRaw, liRaw, overview] = await Promise.all([
      getCompetitors("instagram").catch(() => ({ data: [] })) as Promise<{ data?: Raw[] }>,
      getCompetitors("linkedin").catch(() => ({ data: [] })) as Promise<{ data?: Raw[] }>,
      getSocialOverview().catch(() => []) as Promise<
        Array<{ key: string; followers: number | null; totalPosts: number; totalEngagement: number; totalReach: number; totalImpressions: number }>
      >,
    ]);

    const instagram = (igRaw?.data ?? []).map((c) => normalize(c, "instagram"));
    const linkedin = (liRaw?.data ?? []).map((c) => normalize(c, "linkedin"));

    const meFor = (key: string) => {
      const n = overview.find((o) => o.key === key);
      if (!n) return null;
      const base = n.totalReach > 0 ? n.totalReach : n.totalImpressions;
      return {
        followers: n.followers ?? 0,
        posts: n.totalPosts,
        engagementRate: base > 0 ? Number(((n.totalEngagement / base) * 100).toFixed(2)) : 0,
      };
    };

    return NextResponse.json({
      connected: true,
      instagram,
      linkedin,
      me: { instagram: meFor("instagram"), linkedin: meFor("linkedin") },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ connected: false, error: message, instagram: [], linkedin: [], me: {} });
  }
}
