/**
 * GET /api/seo/topical-map
 *   query: pillar (one of the firm's practice areas, default 'All')
 *
 * Returns the data the /seo/topical-maps page renders:
 *   - One central node per practice area (pillar)
 *   - Child nodes pulled from tracked seo_keywords for that practice area
 *   - Each node carries its current rank so the UI can color it
 *
 * For "All", we return every practice area as a pillar with its keywords as
 * children — a forest of small clusters rather than one giant graph.
 */

import { NextResponse } from "next/server";

import { getTenantDb } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRACTICE_AREAS = [
  "Employment Discrimination",
  "FMLA",
  "Wage & Hour Claims",
  "Wrongful Termination",
  "Sexual Harassment at Work",
  "Severance Negotiations",
  "Commercial Collections",
  "Judgment Enforcement",
];

type KeywordRow = {
  id: string;
  keyword: string;
  practice_area: string | null;
  current_rank: number | null;
  previous_rank: number | null;
  search_volume: number | null;
  difficulty: number | null;
  url: string | null;
};

type Cluster = {
  pillar: string;
  totalVolume: number;
  topRank: number | null;
  childCount: number;
  rankedCount: number;
  keywords: Array<{
    id: string;
    keyword: string;
    rank: number | null;
    previousRank: number | null;
    volume: number | null;
    difficulty: number | null;
    url: string | null;
  }>;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pillarFilter = url.searchParams.get("pillar") ?? "All";

  const sb = await getTenantDb();
  const { data, error } = await sb
    .from("seo_keywords")
    .select(
      "id, keyword, practice_area, current_rank, previous_rank, search_volume, difficulty, url",
    )
    .order("search_volume", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as KeywordRow[];

  // Group by practice area. Keywords without a practice area land in an
  // "Unassigned" cluster so they're still visible.
  const byPillar = new Map<string, KeywordRow[]>();
  for (const r of rows) {
    const key = r.practice_area?.trim() || "Unassigned";
    if (!byPillar.has(key)) byPillar.set(key, []);
    byPillar.get(key)!.push(r);
  }

  // Build clusters. Include empty practice areas too so the UI shows gaps.
  const wantedPillars =
    pillarFilter && pillarFilter !== "All"
      ? [pillarFilter]
      : [...PRACTICE_AREAS, "Unassigned"];

  const clusters: Cluster[] = wantedPillars.map((pillar) => {
    const kws = byPillar.get(pillar) ?? [];
    const ranked = kws.filter((k) => typeof k.current_rank === "number");
    const topRank = ranked.length
      ? Math.min(...ranked.map((k) => k.current_rank as number))
      : null;
    return {
      pillar,
      totalVolume: kws.reduce((s, k) => s + (k.search_volume ?? 0), 0),
      topRank,
      childCount: kws.length,
      rankedCount: ranked.length,
      keywords: kws.map((k) => ({
        id: k.id,
        keyword: k.keyword,
        rank: k.current_rank,
        previousRank: k.previous_rank,
        volume: k.search_volume,
        difficulty: k.difficulty,
        url: k.url,
      })),
    };
  });

  return NextResponse.json({
    pillar: pillarFilter,
    clusters,
    meta: {
      totalKeywords: rows.length,
      practiceAreas: wantedPillars.length,
    },
  });
}
