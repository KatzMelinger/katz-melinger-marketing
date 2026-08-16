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
import { semanticKey } from "@/lib/content-dedup";

export const runtime = "nodejs";

/**
 * Synonym pairs that mean the same page but aren't caught by the generic
 * keyword normalizer (which handles word order, plurals, and attorney/lawyer).
 * Each entry maps a phrase to its canonical form before the semantic key is
 * taken, so "nyc lunch break law" resolves to the same page as "nyc meal break
 * law" instead of showing up unmapped.
 */
const PHRASE_SYNONYMS: [RegExp, string][] = [
  [/\blunch\s+break/gi, "meal break"],
  [/\bmeal\s+period/gi, "meal break"],
  [/\brest\s+break/gi, "meal break"],
  [/\bunjust\s+dismissal/gi, "wrongful termination"],
  [/\bunfair\s+dismissal/gi, "wrongful termination"],
  [/\bfired\s+unfairly/gi, "wrongful termination"],
  // Spanish variants of the same query differ only by preposition and number:
  // "abogados de/por/para despido(s) injustificado(s)/injusto(s)".
  [/\bdespidos\b/gi, "despido"],
  [/\binjustificados\b/gi, "injustificado"],
  [/\binjustos\b/gi, "injustificado"],
  [/\binjusto\b/gi, "injustificado"],
  [/\babogado\b/gi, "abogados"],
  [/\b(?:de|por|para)\s+despido/gi, "despido"],
];

/** Canonical identity for keyword→URL matching: phrase synonyms, then semanticKey. */
function mappingKey(keyword: string): string {
  let s = keyword ?? "";
  for (const [re, to] of PHRASE_SYNONYMS) s = s.replace(re, to);
  return semanticKey(s);
}

type Stage = { kind: string; label: string; order: number };

const DEFAULT_STAGES: Stage[] = [
  { kind: "opportunity", label: "Opportunity", order: 1 },
  { kind: "draft", label: "Draft", order: 2 },
  { kind: "approve", label: "Approve", order: 3 },
  { kind: "published", label: "Published", order: 4 },
];

// content_pipeline.status → the fixed stage vocabulary the board renders.
// The kanban has four columns (Opportunity, Draft, Approve, Published). A brief
// is pre-draft production work, so brief-status items fold into the Draft column
// (their card still opens the DraftDrawer, which knows the brief status).
// review (awaiting sign-off), needs_legal (held by the compliance gate), and
// approved (signed off, awaiting publish) all live in the Approve column.
const PIPE_TO_STAGE: Record<string, string> = {
  idea: "opportunity",
  brief: "draft",
  draft: "draft",
  review: "approve",
  needs_legal: "approve",
  approved: "approve",
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

  const stages: Stage[] = (
    Array.isArray(settings?.workflow_stages) && settings.workflow_stages.length
      ? [...settings.workflow_stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      : DEFAULT_STAGES
  ).filter((s) => s.kind !== "brief"); // Brief column removed; brief items fold into Draft.
  const buckets = Array.isArray(settings?.content_buckets) ? settings.content_buckets : [];
  const pillars = Array.isArray(settings?.pillars)
    ? settings.pillars.map((p: { id: string; label: string }) => ({ id: p.id, label: p.label }))
    : [];

  // Opportunities (the SEO Opportunity Radar) now live in Content Studio, not on
  // this board — the board shows the production pipeline (brief → published) plus
  // position-drop pages for Optimize/Repurpose.
  const [{ data: pipe }, { data: tracked }, { data: sitePages }] = await Promise.all([
    supabase
      .from("content_pipeline")
      .select("id, title, keywords, status, bucket, url, draft_id, suggestion_id, notes")
      .order("updated_at", { ascending: false }),
    // Position-drop source for Optimize/Repurpose: tracked keywords whose rank
    // worsened. A "drop" means the rank NUMBER went up (e.g. #4 → #9). So
    // "dropped > 5 positions" == current_rank - previous_rank > 5.
    supabase
      .from("seo_keywords")
      .select("id, keyword, url, current_rank, previous_rank, search_volume, practice_area")
      .not("current_rank", "is", null),
    // Second mapping source for keywords Search Console couldn't attach a URL
    // to — the live page may exist under a different phrasing.
    supabase.from("site_pages").select("url, title, h1").limit(2000),
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
    // Who created the pipeline row: Peggy (chat), the autonomous agent (cron),
    // or a human (brief wizard / manual). Derived from the deterministic note
    // prefixes draft-to-review.ts writes.
    createdBy: "peggy" | "agent" | "manual";
    // Position-drop fields (source === "page" only)
    rankDrop?: number;
    currentRank?: number | null;
    previousRank?: number | null;
    /**
     * How this row's URL was resolved:
     *   tracked  — Search Console attached it directly.
     *   variant  — matched a phrasing variant / synonym of an already-mapped
     *              keyword, or a live page title.
     *   unmapped — no page could be found. The card must SAY so; silently
     *              dropping the URL and both action buttons made a mapping
     *              failure look identical to a keyword with nothing to do.
     */
    urlSource?: "tracked" | "variant" | "unmapped";
  };
  const items: Item[] = [];

  // Pipeline items: the production stages (brief → published).
  for (const p of pipe ?? []) {
    const note = ((p.notes as string) ?? "").toLowerCase();
    const createdBy: Item["createdBy"] = note.startsWith("created by peggy")
      ? "peggy"
      : note.startsWith("autonomous agent")
        ? "agent"
        : "manual";
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
      createdBy,
    });
  }

  // Low-scoring + slipped pages → Optimize/Repurpose (existing tab). A page is
  // surfaced if it currently ranks poorly (worse than #LOW_RANK = off page 1) OR
  // it dropped more than DROP positions. Dedupe by URL so a page already
  // surfaced via an opportunity's existing_url isn't doubled.
  const LOW_RANK = 10; // worse than #10 = off page 1 = "scoring low"
  const DROP = 5; // dropped more than 5 positions
  const seenUrls = new Set(items.filter((i) => i.url).map((i) => (i.url as string).toLowerCase()));

  // Keyword → URL index for the variant fallback. Built from every tracked
  // keyword that already HAS a URL, plus live page titles. This is what makes
  // "abogados de despidos injustos" resolve to the same page as "abogados de
  // despido injustificado", and "nyc lunch break law" to the meal-break page.
  const urlByKey = new Map<string, string>();
  for (const t of tracked ?? []) {
    const url = ((t.url as string) ?? "").trim();
    const keyword = ((t.keyword as string) ?? "").trim();
    if (!url || !keyword) continue;
    const key = mappingKey(keyword);
    if (key && !urlByKey.has(key)) urlByKey.set(key, url);
  }
  for (const p of (sitePages ?? []) as { url: string; title: string | null; h1: string | null }[]) {
    const url = (p.url ?? "").trim();
    if (!url) continue;
    for (const label of [p.title, p.h1]) {
      const key = label ? mappingKey(label) : "";
      if (key && !urlByKey.has(key)) urlByKey.set(key, url);
    }
  }

  for (const t of tracked ?? []) {
    const cur = t.current_rank as number | null;
    const prev = t.previous_rank as number | null;
    if (cur == null) continue;
    const drop = prev != null ? cur - prev : 0; // positive = rank worsened
    const slipped = prev != null && drop > DROP;
    const lowRank = cur > LOW_RANK;
    if (!slipped && !lowRank) continue;

    const trackedUrl = ((t.url as string) ?? "").trim();
    // Before treating a keyword as unmapped, check whether it's a phrasing
    // variant or synonym of one that already resolves to a live page.
    const variantUrl = trackedUrl
      ? ""
      : (urlByKey.get(mappingKey((t.keyword as string) ?? "")) ?? "");
    const url = trackedUrl || variantUrl || null;
    const urlSource: Item["urlSource"] = trackedUrl
      ? "tracked"
      : variantUrl
        ? "variant"
        : "unmapped";

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
      createdBy: "manual",
      rankDrop: slipped ? drop : undefined,
      currentRank: cur,
      previousRank: prev,
      urlSource,
    });
  }

  const counts = {
    new: items.filter((i) => i.tab === "new").length,
    existing: items.filter((i) => i.tab === "existing").length,
    needsReview: items.filter((i) => i.needsReview).length,
    // Surfaced so a mapping regression is visible as a number, not just as
    // cards that quietly do nothing.
    unmapped: items.filter((i) => i.urlSource === "unmapped").length,
  };

  return NextResponse.json({ stages, buckets, pillars, items, counts });
}
