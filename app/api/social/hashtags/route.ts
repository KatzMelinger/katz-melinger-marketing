/**
 * GET /api/social/hashtags  — Screen 5 (Hashtag Performance)
 *
 * Metricool's hashtag endpoint only returns GLOBAL hashtag volume (a
 * competitiveness signal), not our per-tag performance. So we compute our own
 * performance by parsing the hashtags out of our Instagram posts' captions and
 * attributing each post's reach/engagement to the tags it used, then cross-
 * reference the global-volume list to flag generic/over-competitive tags.
 *
 *   - topTags   : our tags ranked by the average reach they drove for us
 *   - lowTags   : tags we use that are generic/over-competitive (high global
 *                 volume) and worth replacing
 *   - suggested : niche tags (not over-competitive) that drove the most reach
 *
 * Instagram only — LinkedIn/Facebook post analytics don't return caption text.
 */

import { NextResponse } from "next/server";

import { getPosts, getHashtags } from "@/lib/metricool";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A tag is "over-competitive" if it appears in the global popular-tags list.
// We surface its global volume so the UI can show just how saturated it is.
const TAG_RE = /#[\p{L}\p{N}_]+/gu;

type IgPost = { content?: string; reach?: number; engagement?: number; saved?: number };
type TagStat = {
  tag: string;
  uses: number;
  totalReach: number;
  totalEngagement: number;
  avgReach: number;
  avgEngagement: number;
  globalVolume: number | null;
  overCompetitive: boolean;
};

function ninetyDays(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  return { from: from.toISOString().split(".")[0], to: to.toISOString().split(".")[0] };
}

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  try {
    const range = ninetyDays();
    const [postsRaw, globalRaw] = await Promise.all([
      getPosts("instagram", range) as Promise<{ data?: IgPost[] }>,
      getHashtags("instagram", range).catch(() => ({ data: [] })) as Promise<{
        data?: Array<{ name?: string; postsCount?: number }>;
      }>,
    ]);

    const posts = postsRaw?.data ?? [];
    const globalMap = new Map<string, number>();
    for (const g of globalRaw?.data ?? []) {
      if (g?.name) globalMap.set(g.name.toLowerCase(), Number(g.postsCount) || 0);
    }

    // Attribute each post's reach/engagement to every hashtag it used.
    const stats = new Map<string, TagStat>();
    for (const p of posts) {
      const text = typeof p.content === "string" ? p.content : "";
      const tags = [...new Set((text.match(TAG_RE) ?? []).map((t) => t.slice(1).toLowerCase()))];
      const reach = Number(p.reach) || 0;
      const eng = Number(p.engagement) || 0;
      for (const tag of tags) {
        const cur =
          stats.get(tag) ??
          ({
            tag,
            uses: 0,
            totalReach: 0,
            totalEngagement: 0,
            avgReach: 0,
            avgEngagement: 0,
            globalVolume: globalMap.has(tag) ? globalMap.get(tag)! : null,
            overCompetitive: globalMap.has(tag),
          } satisfies TagStat);
        cur.uses += 1;
        cur.totalReach += reach;
        cur.totalEngagement += eng;
        stats.set(tag, cur);
      }
    }

    const all = [...stats.values()].map((s) => ({
      ...s,
      avgReach: s.uses > 0 ? Math.round(s.totalReach / s.uses) : 0,
      avgEngagement: s.uses > 0 ? Math.round(s.totalEngagement / s.uses) : 0,
    }));

    const topTags = [...all].sort((a, b) => b.avgReach - a.avgReach).slice(0, 12);
    const lowTags = all
      .filter((t) => t.overCompetitive)
      .sort((a, b) => (b.globalVolume ?? 0) - (a.globalVolume ?? 0))
      .slice(0, 12);
    const suggested = all
      .filter((t) => !t.overCompetitive && t.avgReach > 0)
      .sort((a, b) => b.avgReach - a.avgReach)
      .slice(0, 8)
      .map((t) => t.tag);

    return NextResponse.json({
      connected: true,
      postsAnalyzed: posts.length,
      windowDays: 90,
      topTags,
      lowTags,
      suggested,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ connected: false, error: message, topTags: [], lowTags: [], suggested: [] });
  }
}
