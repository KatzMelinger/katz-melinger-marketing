/**
 * POST /api/content-production/update-draft
 *   body: { url, title?, pillarId?, practiceArea?, intent?, keywords?: string[] }
 *
 * Repurpose flow: take an already-published page, fetch what's live today, and
 * generate an UPDATED draft to the firm's guidelines — rewritten in brand
 * voice, with the matched "missing keyword" opportunities worked in and
 * internal links to related cluster-map pages added. The result is saved as a
 * content_draft and surfaced on the Production Board (a content_pipeline row at
 * "draft") so it flows through the existing review / QA / publish drawer.
 *
 * WordPress write-back stays Phase 4 — this produces the reviewed draft; the
 * drawer's "Approve → Publish" still advances editorial status only.
 */

import { NextResponse } from "next/server";

import {
  cachedSystemPrompt,
  CONTENT_LONG_FORM_MODEL,
  getAnthropic,
} from "@/lib/anthropic";
import { guardUser } from "@/lib/supabase-route";
import { stripEmDashes } from "@/lib/sanitize-content";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { getTenantConfig } from "@/lib/tenant-config";
import { getFirmContext } from "@/lib/firm-context";
import { buildSkillsContext } from "@/lib/content-skills";
import { scheduleDraftAnalysis } from "@/lib/auto-analyze";
import { fetchPageOutline } from "@/lib/page-optimizer";
import {
  detectContentType,
  auditGaps,
  gapReportPromptBlock,
  headingGuidanceBlock,
  parseMarkdownHeadings,
  summarizeHeadingChanges,
} from "@/lib/redraft-analyze";
import { autoSeoMetadata } from "@/lib/strategy-engine";
import { getPillars } from "@/lib/pillars-store";
import {
  buildLinkPlan,
  approvedLinkPlanBlock,
  suggestOrphanLinkers,
  type LinkPlan,
} from "@/lib/internal-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = str(body.url);
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

  const title = str(body.title);
  const pillarId = str(body.pillarId);
  const practiceArea = str(body.practiceArea); // "employment" | "collections"
  const intent = str(body.intent); // "commercial" | "informational"
  const keywords = Array.isArray(body.keywords)
    ? (body.keywords as unknown[]).filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : [];

  const tenantId = await resolveTenantId();
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // 1. What's live today — the thing we're updating, not replacing blind. We
  //    fetch the heading outline too so the Gap Audit can see structure.
  let outline;
  try {
    outline = await fetchPageOutline(url);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not fetch the page." },
      { status: 422 },
    );
  }
  const pageText = outline.text;

  // Stage 1 (Content Type Detection) + Stage 2 (Gap Audit). Deterministic-first
  // type detection; a per-type section checklist + keyword gaps drive an ADDITIVE
  // redraft that fills what's missing without rewriting what already works.
  const detected = await detectContentType(outline, url);
  const gapReport = auditGaps(outline, detected, keywords);

  // 2. Allowed internal links — site-wide bidirectional discovery over the
  //    cluster map (site_pages), NOT just the assigned pillar. buildLinkPlan
  //    finds confirmed live pages this page should link to (outbound), always
  //    includes the pillar up-link, and flags same-primary-keyword pages as
  //    cannibalization; suggestOrphanLinkers finds existing pages that should
  //    link back to this one (inbound). The generator may use ONLY the outbound
  //    links, so it can't invent internal URLs. Previously this pulled only
  //    same-pillar pages, so an empty pillar (e.g. Severance) yielded zero links.
  // Enrich the topical term set with the page's own H2/H3 headings so discovery
  // has real signal even when the caller passes few keywords (H1 is excluded —
  // it's the page's own title). Deduped, non-trivial headings only.
  const headingTerms = Array.from(
    new Set(
      outline.headings
        .filter((h) => h.level >= 2 && h.level <= 3)
        .map((h) => h.text.trim())
        .filter((t) => t.length >= 4),
    ),
  ).slice(0, 12);

  let linkPlan: LinkPlan;
  try {
    linkPlan = await buildLinkPlan({
      primaryKeyword: title || url,
      secondaryKeywords: keywords,
      faqQuestions: headingTerms,
      pillarId: pillarId || undefined,
      excludeUrl: url,
      // Redraft-specific: cast wider than the generators (up to 3 pages per
      // term) but cap the plan at 8 so an updated page isn't over-linked.
      perTermLimit: 3,
      maxLinks: 8,
    });
  } catch {
    linkPlan = { links: [], flagged: [] };
  }
  const inbound = await suggestOrphanLinkers(url).catch(() => null);

  // 3. Known firm information — same brand voice the analyzer scores against,
  //    plus the firm's trained content directions.
  const [firmContext, skillsContext] = await Promise.all([
    getFirmContext(tenantId).catch(() => ""),
    buildSkillsContext(
      { practiceArea: practiceArea === "collections" ? "Collections" : "Employment" },
      tenantId,
    ).catch(() => ""),
  ]);

  const linkBlock =
    linkPlan.links.length > 0 ? `\n\n${approvedLinkPlanBlock(linkPlan.links)}` : "";

  const keywordBlock =
    keywords.length > 0
      ? `\n\nTARGET KEYWORDS TO WORK IN — these are opportunities this page is missing. Weave them in naturally (in headings and body where they fit), no stuffing:\n${keywords.map((k) => `- ${k}`).join("\n")}`
      : "";

  const knownInfo = [
    firmContext &&
      `FIRM CONTEXT — write in this firm's voice and to these audiences; use contact details verbatim. This is the same brand-voice guide the draft is scored against:\n${firmContext}`,
    skillsContext,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const userPrompt =
    `${knownInfo ? knownInfo + "\n\n===\n\n" : ""}` +
    `You are UPDATING an already-published page — not writing a new one from scratch. This is an ` +
    `ADDITIVE update: keep the accurate, on-topic content that already works and add what's missing.\n\n` +
    `CURRENT PUBLISHED PAGE\n` +
    `URL: ${url}\n` +
    (title ? `Title: ${title}\n` : "") +
    `--- current content (extracted from the live page) ---\n${pageText}\n--- end current content ---\n\n` +
    `${gapReportPromptBlock(gapReport)}\n\n` +
    `${headingGuidanceBlock(outline, title)}\n\n` +
    `UPDATE INSTRUCTIONS\n` +
    `- Preserve sections that are already accurate and on-topic. Do NOT rewrite them wholesale — light voice/clarity edits only.\n` +
    `- ADD the missing sections and keywords listed above, in the firm's brand voice and to its audiences (see FIRM CONTEXT).\n` +
    `- Keep every factual, legal, and numeric statement accurate. Do NOT invent statutes, deadlines, figures, or case results — if the live page doesn't support a claim, leave it out.\n` +
    `- Follow the HEADING RULES above: keep strong headings verbatim, improve weak ones for SEO, add headings only for the gaps.\n` +
    keywordBlock +
    linkBlock +
    `\n\nOutput: the full updated page in Markdown only. Start with the H1.`;

  const tenantConfig = await getTenantConfig(tenantId);

  let updatedBody = "";
  try {
    const msg = await getAnthropic().messages.create({
      model: CONTENT_LONG_FORM_MODEL,
      max_tokens: 8192,
      system: cachedSystemPrompt(tenantConfig.systemPrompt),
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = msg.content.find((b) => b.type === "text");
    // Hard filter: strip em/en dashes before persisting. See lib/sanitize-content.ts.
    updatedBody = stripEmDashes(block && block.type === "text" ? block.text : "");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generation failed" },
      { status: 500 },
    );
  }

  if (!updatedBody.trim()) {
    return NextResponse.json({ error: "The model returned an empty draft." }, { status: 502 });
  }

  // Heading changes: compare the live page's headings against the redraft's, so
  // the reviewer can see the H1/section changes at a glance (kept vs improved vs
  // added) rather than diffing by eye.
  const headingChanges = summarizeHeadingChanges(
    outline.headings,
    parseMarkdownHeadings(updatedBody),
  );

  // Stage 3 metadata: fill meta title/description/slug/pillar (the old redraft
  // left these empty, so WordPress push + the drawer had nothing). Reuses the
  // wizard's deterministic derivation. Prefer an explicitly-passed pillar.
  let seoMeta: Awaited<ReturnType<typeof autoSeoMetadata>> | null = null;
  try {
    seoMeta = await autoSeoMetadata({
      topic: title || url,
      secondaryKeywords: keywords,
      tenantId,
      pillars: await getPillars(tenantId),
    });
  } catch {
    /* non-fatal — draft still saves without auto metadata */
  }

  // 4. Save the draft.
  const draftTitle = title || url;
  const resolvedPillar = pillarId || seoMeta?.pillarId || null;
  const { data: draftRow, error: draftErr } = await supabase
    .from("content_drafts")
    .insert({
      tenant_id: tenantId,
      format: "km_page_update",
      template: "km_page_update",
      topic: draftTitle,
      practice_area: practiceArea === "collections" ? "Commercial Collections" : "Employment Law",
      title: draftTitle,
      body: updatedBody,
      metadata: {
        origin_source: "page_update",
        source_url: url,
        update_keywords: keywords,
        pillar_id: resolvedPillar,
        // Stages 1–2 result, surfaced so the reviewer sees what the redraft
        // detected and which gaps it set out to fill.
        redraft_analysis: {
          contentType: gapReport.contentType,
          detectedBy: gapReport.detectedBy,
          missingSections: gapReport.missingSections,
          missingKeywords: gapReport.missingKeywords,
          notes: gapReport.notes,
          headingChanges,
        },
        km_brief: {
          primaryKeyword: title || url,
          secondaryKeywords: keywords,
          pillarId: resolvedPillar,
          internalPillarLink: linkPlan.links[0]?.url ?? null,
          internalLinks: linkPlan.links,
        },
        // Bidirectional link discovery, surfaced for the reviewer: outbound
        // links the redraft placed, inbound pages that should link back here,
        // and cannibalization flags (same-primary-keyword pages, excluded).
        internal_links: {
          outbound: linkPlan.links,
          inbound: inbound?.sources ?? [],
          flagged: linkPlan.flagged,
        },
      },
      seo_brief: {
        primaryKeyword: title || url,
        secondaryKeywords: keywords,
        pillarId: resolvedPillar,
        targetKeywords: keywords,
        // Auto-filled metadata (was empty on the old redraft path).
        ...(seoMeta
          ? {
              metaTitle: seoMeta.metaTitle,
              metaDescription: seoMeta.metaDescription,
              urlSlug: seoMeta.urlSlug,
              searchIntent: seoMeta.searchIntent,
            }
          : {}),
      },
    })
    .select("id")
    .single();

  if (draftErr || !draftRow) {
    return NextResponse.json(
      { error: draftErr?.message ?? "Could not save the draft." },
      { status: 500 },
    );
  }
  const draftId = draftRow.id as string;

  // 5. Surface on the Production Board — reuse the row for this URL if one
  //    already exists, otherwise create one at "draft".
  const bucket = intent === "commercial" ? "money_page" : "bofu_education";
  const { data: existing } = await supabase
    .from("content_pipeline")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("url", url)
    .limit(1)
    .maybeSingle();

  let pipelineId: number | null = null;
  if (existing) {
    pipelineId = (existing as { id: number }).id;
    await supabase
      .from("content_pipeline")
      .update({ draft_id: draftId, status: "draft", title: draftTitle })
      .eq("id", pipelineId);
  } else {
    const { data: created } = await supabase
      .from("content_pipeline")
      .insert({
        tenant_id: tenantId,
        title: draftTitle,
        keywords: keywords.join(", ") || null,
        status: "draft",
        bucket,
        content_type: "website",
        url,
        draft_id: draftId,
      })
      .select("id")
      .single();
    pipelineId = (created?.id as number | undefined) ?? null;
  }

  // 6. Score it like any other draft.
  scheduleDraftAnalysis({
    draftId,
    body: updatedBody,
    title: draftTitle,
    topic: draftTitle,
    format: "km_page_update",
    template: "km_page_update",
    targetKeywords: keywords,
  });

  return NextResponse.json({
    draft_id: draftId,
    pipeline_id: pipelineId,
    status: "draft",
    title: draftTitle,
    url,
    // Stages 1–2, echoed so the caller can show what was detected/filled.
    redraft_analysis: {
      contentType: gapReport.contentType,
      detectedBy: gapReport.detectedBy,
      missingSections: gapReport.missingSections,
      missingKeywords: gapReport.missingKeywords,
      notes: gapReport.notes,
      headingChanges,
    },
    // Two lists per the spec: outbound (this page links out) + inbound (existing
    // pages that should link back), plus cannibalization flags.
    internal_links: {
      outbound: linkPlan.links,
      inbound: inbound?.sources ?? [],
      flagged: linkPlan.flagged,
    },
  });
}
