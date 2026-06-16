/**
 * GET /api/content-production/optimize
 *
 * Read model for the Content Production "Repurpose" tab: every published page
 * in the site inventory, classified by keyword cluster + intent, and matched to
 * the "missing keyword" opportunities it could pick up in an update.
 *
 * Pages are sorted so the best update candidates (most matched opportunities,
 * then highest combined search volume) float to the top — "the pages we can
 * update day by day". Pages with no matched opportunity are still returned (the
 * reviewer may still want to refresh them), just lower in the list.
 */

import { NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";
import { ALL_KM_PILLARS } from "@/lib/km-content-system";
import {
  matchOpportunitiesToPage,
  pageCluster,
  pageIntent,
  type OppLike,
} from "@/lib/page-optimizer";

export const runtime = "nodejs";

const PILLAR_LABEL: Record<string, string> = Object.fromEntries(
  ALL_KM_PILLARS.map((p) => [p.id, p.label]),
);

type MatchView = {
  id: string;
  keyword: string;
  intent: string | null;
  searchVolume: number | null;
  recommendedContentType: string | null;
};

type PageView = {
  url: string;
  title: string | null;
  pageType: string;
  pillarId: string | null;
  pillarLabel: string | null;
  practiceArea: string | null;
  cluster: string;
  clusterKey: string;
  intent: "commercial" | "informational";
  matches: MatchView[];
  matchedVolume: number;
  /** A live pipeline row already exists for this URL (so we don't double-create). */
  inPipeline: boolean;
};

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  const { supabase } = await getTenantClient();

  const [{ data: pages, error: pagesErr }, { data: opps }, { data: pipe }] =
    await Promise.all([
      supabase
        .from("site_pages")
        .select("url, title, h1, page_type, pillar, practice_area, topics")
        .limit(1000),
      supabase
        .from("seo_opportunities")
        .select("id, keyword, pillar_id, practice_area, intent, search_volume, recommended_content_type, status")
        .eq("excluded", false),
      supabase.from("content_pipeline").select("url"),
    ]);

  if (pagesErr) {
    return NextResponse.json({ error: pagesErr.message }, { status: 500 });
  }

  // Only "new" opportunities are candidates to add — anything already in
  // production has its own board row.
  const candidates = ((opps ?? []) as (OppLike & { status?: string })[]).filter(
    (o) => !o.status || o.status === "new",
  );
  const pipelineUrls = new Set(
    ((pipe ?? []) as { url: string | null }[])
      .map((p) => (p.url ?? "").trim().toLowerCase())
      .filter(Boolean),
  );

  const out: PageView[] = [];
  for (const p of (pages ?? []) as {
    url: string;
    title: string | null;
    h1: string | null;
    page_type: string;
    pillar: string | null;
    practice_area: string | null;
    topics: string[] | null;
  }[]) {
    const matched = matchOpportunitiesToPage(p, candidates);
    const cluster = pageCluster(p);
    const matches: MatchView[] = matched.map((m) => ({
      id: m.id,
      keyword: m.keyword,
      intent: m.intent,
      searchVolume: m.search_volume,
      recommendedContentType: m.recommended_content_type,
    }));
    const matchedVolume = matches.reduce((s, m) => s + (m.searchVolume ?? 0), 0);
    out.push({
      url: p.url,
      title: p.title,
      pageType: p.page_type,
      pillarId: p.pillar,
      pillarLabel: p.pillar ? (PILLAR_LABEL[p.pillar] ?? p.pillar) : null,
      practiceArea: p.practice_area,
      cluster: cluster.label,
      clusterKey: cluster.key,
      intent: pageIntent(p.page_type),
      matches,
      matchedVolume,
      inPipeline: pipelineUrls.has((p.url ?? "").trim().toLowerCase()),
    });
  }

  // Best update candidates first: most matched opportunities, then volume.
  out.sort(
    (a, b) =>
      b.matches.length - a.matches.length || b.matchedVolume - a.matchedVolume,
  );

  return NextResponse.json({
    pages: out,
    counts: {
      total: out.length,
      withOpportunities: out.filter((p) => p.matches.length > 0).length,
    },
  });
}
