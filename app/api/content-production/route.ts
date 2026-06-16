/**
 * GET /api/content-production
 *
 * Read model for the unified Content Production board. Assembles the board by
 * reading the team's EXISTING tables directly via the RLS-scoped getTenantDb():
 *   - seo_opportunities  → the "new content" funnel (keywords not yet a page)
 *   - content_pipeline   → production stages (brief → published)
 *   - content_drafts     → linked via draft_id (artifacts)
 * plus the tenant's per-tenant board config (workflow_stages + content_buckets).
 *
 * DECISION (Option C): no content_items spine — we read the tables directly.
 * Chosen for SaaS safety (RLS enforced per base-table query; no cross-tenant view
 * footgun; no dual-write drift) and reversibility. See
 * docs/content-production-board-decisions.md — REVISIT: promote to a `content_items`
 * VIEW (perf) or TABLE (if this becomes the source of truth) later.
 *
 * Tabs are derived, not stored:
 *   - new       : opportunities (status=new, no page) + all content_pipeline items
 *   - optimize  : existing pages (opportunities with existing_url)   [Stage 6 wiring]
 *   - repurpose : existing pages (opportunities with existing_url)   [Stage 6 wiring]
 */

import { NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";

export const runtime = "nodejs";

type Stage = { kind: string; label: string; order: number };

const DEFAULT_STAGES: Stage[] = [
  { kind: "opportunity", label: "Opportunity", order: 1 },
  { kind: "brief", label: "Brief", order: 2 },
  { kind: "draft", label: "Draft", order: 3 },
  { kind: "approve", label: "Approve", order: 4 },
  { kind: "published", label: "Published", order: 5 },
];

// content_pipeline.status → the fixed stage vocabulary the board renders.
const PIPE_TO_STAGE: Record<string, string> = {
  idea: "opportunity",
  brief: "brief",
  draft: "draft",
  review: "approve",
  published: "published",
};

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  const supabase = await getTenantDb();

  const { data: settings } = await supabase
    .from("tenant_settings")
    .select("workflow_stages, content_buckets, pillars")
    .maybeSingle();

  const stages: Stage[] =
    Array.isArray(settings?.workflow_stages) && settings.workflow_stages.length
      ? [...settings.workflow_stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      : DEFAULT_STAGES;
  const buckets = Array.isArray(settings?.content_buckets) ? settings.content_buckets : [];
  const pillars = Array.isArray(settings?.pillars)
    ? settings.pillars.map((p: { id: string; label: string }) => ({ id: p.id, label: p.label }))
    : [];

  // Opportunities (the SEO Opportunity Radar) now live in Content Studio, not on
  // this board — the board shows the production pipeline (brief → published) plus
  // position-drop pages for Optimize/Repurpose.
  const [{ data: pipe }, { data: tracked }] = await Promise.all([
    supabase
      .from("content_pipeline")
      .select("id, title, keywords, status, bucket, url, draft_id, suggestion_id")
      .order("updated_at", { ascending: false }),
    // Position-drop source for Optimize/Repurpose: tracked keywords whose rank
    // worsened. A "drop" means the rank NUMBER went up (e.g. #4 → #9). So
    // "dropped > 5 positions" == current_rank - previous_rank > 5.
    supabase
      .from("seo_keywords")
      .select("id, keyword, url, current_rank, previous_rank, search_volume, practice_area")
      .not("current_rank", "is", null)
      .not("previous_rank", "is", null),
  ]);

  type Item = {
    id: string;
    title: string;
    stageKind: string;
    tab: "new" | "existing";
    source: "opportunity" | "pipeline" | "page";
    pillarId: string | null;
    practiceArea: string | null;
    assetType: string | null;
    bucket: string | null;
    url: string | null;
    draftId: string | null;
    needsReview: boolean;
    // Inputs the existing components need when a card action opens them:
    // opportunity → KmBriefWizard; pipeline → DraftDrawer.
    intent: string | null;
    competitor: string | null;
    searchVolume: number | null;
    pipelineId: number | null; // content_pipeline.id (numeric) for DraftDrawer
    rawStatus: string | null; // content_pipeline.status for DraftDrawer
    keywords: string | null;
    suggestionId: string | null; // brief_suggestions.id — the brief behind a brief-stage row
    // Position-drop fields (source === "page" only)
    rankDrop?: number;
    currentRank?: number | null;
    previousRank?: number | null;
  };
  const items: Item[] = [];

  // Pipeline items: the production stages (brief → published).
  for (const p of pipe ?? []) {
    items.push({
      id: p.id as string,
      title: (p.title as string) ?? (p.keywords as string) ?? "(untitled)",
      stageKind: PIPE_TO_STAGE[(p.status as string) ?? "idea"] ?? "opportunity",
      tab: "new",
      source: "pipeline",
      pillarId: null,
      practiceArea: null,
      assetType: null,
      bucket: (p.bucket as string) ?? null,
      url: (p.url as string) ?? null,
      draftId: (p.draft_id as string) ?? null,
      needsReview: false,
      intent: null,
      competitor: null,
      searchVolume: null,
      pipelineId: (p.id as number) ?? null,
      rawStatus: (p.status as string) ?? null,
      keywords: (p.keywords as string) ?? null,
      suggestionId: (p.suggestion_id as string) ?? null,
    });
  }

  // Position-drop pages → Optimize/Repurpose (existing tab). Dedupe by URL so a
  // page already surfaced via an opportunity's existing_url isn't doubled.
  const seenUrls = new Set(items.filter((i) => i.url).map((i) => (i.url as string).toLowerCase()));
  for (const t of tracked ?? []) {
    const cur = t.current_rank as number | null;
    const prev = t.previous_rank as number | null;
    if (cur == null || prev == null) continue;
    const drop = cur - prev; // positive = rank worsened
    if (drop <= 5) continue; // only "dropped more than 5 positions"
    const url = (t.url as string) ?? null;
    if (url && seenUrls.has(url.toLowerCase())) continue;
    if (url) seenUrls.add(url.toLowerCase());
    items.push({
      id: `kw-${t.id}`,
      title: (t.keyword as string) ?? url ?? "(untitled)",
      stageKind: "published",
      tab: "existing",
      source: "page",
      pillarId: null,
      practiceArea: (t.practice_area as string) ?? null,
      assetType: null,
      bucket: null,
      url,
      draftId: null,
      needsReview: false,
      intent: null,
      competitor: null,
      searchVolume: (t.search_volume as number) ?? null,
      pipelineId: null,
      rawStatus: null,
      keywords: null,
      suggestionId: null,
      rankDrop: drop,
      currentRank: cur,
      previousRank: prev,
    });
  }

  const counts = {
    new: items.filter((i) => i.tab === "new").length,
    existing: items.filter((i) => i.tab === "existing").length,
    needsReview: items.filter((i) => i.needsReview).length,
  };

  return NextResponse.json({ stages, buckets, pillars, items, counts });
}
