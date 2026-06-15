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

  const [{ data: opps }, { data: pipe }] = await Promise.all([
    supabase
      .from("seo_opportunities")
      .select("id, keyword, status, pillar_id, practice_area, recommended_content_type, existing_url")
      .eq("excluded", false),
    supabase
      .from("content_pipeline")
      .select("id, title, keywords, status, bucket, url, draft_id")
      .order("updated_at", { ascending: false }),
  ]);

  type Item = {
    id: string;
    title: string;
    stageKind: string;
    tab: "new" | "existing";
    source: "opportunity" | "pipeline";
    pillarId: string | null;
    practiceArea: string | null;
    assetType: string | null;
    bucket: string | null;
    url: string | null;
    draftId: string | null;
    needsReview: boolean;
  };
  const items: Item[] = [];

  // Opportunities: status=new with no page yet → "new content" Opportunity column.
  // Opportunities with an existing page → "optimize"/"repurpose" candidates.
  for (const o of opps ?? []) {
    const hasPage = Boolean(o.existing_url);
    if (!hasPage && o.status !== "new") continue; // advanced ones show via pipeline
    items.push({
      id: o.id as string,
      title: (o.keyword as string) ?? "(untitled)",
      stageKind: "opportunity",
      tab: hasPage ? "existing" : "new",
      source: "opportunity",
      pillarId: (o.pillar_id as string) ?? null,
      practiceArea: (o.practice_area as string) ?? null,
      assetType: (o.recommended_content_type as string) ?? null,
      bucket: null,
      url: (o.existing_url as string) ?? null,
      draftId: null,
      needsReview: !o.pillar_id,
    });
  }

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
    });
  }

  const counts = {
    new: items.filter((i) => i.tab === "new").length,
    existing: items.filter((i) => i.tab === "existing").length,
    needsReview: items.filter((i) => i.needsReview).length,
  };

  return NextResponse.json({ stages, buckets, pillars, items, counts });
}
