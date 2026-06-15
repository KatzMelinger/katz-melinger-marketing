/**
 * /api/content/km-draft — Katz Melinger AI content generation.
 *
 * This route is the strict, system-prompt-driven content generator. It
 * accepts a fully-filled Per-Page Brief and runs Anthropic with the full
 * KM_SYSTEM_PROMPT loaded as the system parameter (cached, so subsequent
 * generations are cheap).
 *
 * Unlike /api/content/draft, this endpoint REQUIRES every brief field to
 * be valid before generating. If validation fails, returns 400 with the
 * list of missing fields.
 *
 * Autosaves to content_drafts with format = "km_practice_page" |
 * "km_blog_post" | "km_case_result" so the new generations are filterable
 * from the older free-form ones.
 */

import { NextResponse } from "next/server";

import {
  cachedSystemPrompt,
  CONTENT_LONG_FORM_MODEL,
  getAnthropic,
} from "@/lib/anthropic";
import {
  buildBriefUserPrompt,
  KM_CONTENT_TYPE_LABELS,
  KM_HUB_LINKS,
  validateBrief,
  type KMContentType,
  type KMPerPageBrief,
  type KMPracticeArea,
  type KMSearchIntent,
} from "@/lib/km-content-system";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { getPillars } from "@/lib/pillars-store";
import { detectContentOverlap } from "@/lib/content-overlap";
import {
  languageDirective,
  normalizeLanguage,
  type ContentLanguage,
} from "@/lib/content-language";
import { getTenantConfig } from "@/lib/tenant-config";
import { scheduleDraftAnalysis } from "@/lib/auto-analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: KMContentType[] = ["practice_page", "blog_post", "case_result"];
const PRACTICE_AREAS: KMPracticeArea[] = ["employment", "collections"];
const SEARCH_INTENTS: KMSearchIntent[] = ["informational", "commercial", "proof"];

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

function asInternalLinks(v: unknown): KMPerPageBrief["internalLinks"] {
  if (!Array.isArray(v)) return [];
  const out: NonNullable<KMPerPageBrief["internalLinks"]> = [];
  for (const item of v) {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const url = asString(o.url).trim();
      if (!url) continue;
      out.push({
        url,
        anchor: asString(o.anchor).trim() || url,
        section: asString(o.section).trim() || "Body",
      });
    }
  }
  return out;
}

function parseBrief(o: Record<string, unknown>): Partial<KMPerPageBrief> {
  const contentType = CONTENT_TYPES.includes(o.contentType as KMContentType)
    ? (o.contentType as KMContentType)
    : undefined;
  const practiceArea = PRACTICE_AREAS.includes(o.practiceArea as KMPracticeArea)
    ? (o.practiceArea as KMPracticeArea)
    : undefined;
  const searchIntent = SEARCH_INTENTS.includes(o.searchIntent as KMSearchIntent)
    ? (o.searchIntent as KMSearchIntent)
    : undefined;

  return {
    contentType,
    practiceArea,
    searchIntent,
    primaryKeyword: asString(o.primaryKeyword).trim(),
    pillarId: asString(o.pillarId).trim(),
    urlSlug: asString(o.urlSlug).trim(),
    metaTitle: asString(o.metaTitle).trim(),
    metaDescription: asString(o.metaDescription).trim(),
    h1: asString(o.h1).trim(),
    internalPillarLink: asString(o.internalPillarLink).trim(),
    cannibalizationConfirmed: o.cannibalizationConfirmed === true,
    cannibalizationNotes: asString(o.cannibalizationNotes).trim() || undefined,
    secondaryKeywords: asStringArray(o.secondaryKeywords),
    statutes: asStringArray(o.statutes),
    deadlines: asStringArray(o.deadlines),
    evidenceTypes: asStringArray(o.evidenceTypes),
    thresholds: asStringArray(o.thresholds),
    faqQuestions: asStringArray(o.faqQuestions),
    internalLinks: asInternalLinks(o.internalLinks),
    specialInstructions: asString(o.specialInstructions).trim() || undefined,
  };
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const partial = parseBrief(body as Record<string, unknown>);
  const errors = validateBrief(partial);

  // Cross-field check: pillar must belong to the selected practice area
  // (validated against the live, DB-driven pillar list).
  if (partial.practiceArea && partial.pillarId) {
    const pillars = await getPillars();
    const ok = pillars.some(
      (p) => p.id === partial.pillarId && p.practiceArea === partial.practiceArea,
    );
    if (!ok) errors.push("Pillar mapping does not match the selected practice area");
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: "Brief is incomplete", details: errors }, { status: 400 });
  }

  const brief = partial as KMPerPageBrief;
  const language = normalizeLanguage((body as Record<string, unknown>).language);

  // If this draft is being generated from a brief_suggestion, we'll advance the
  // matching Production Board row once the draft is saved (see linkPipelineDraft).
  const suggestionId =
    typeof (body as Record<string, unknown>).suggestionId === "string"
      ? ((body as Record<string, unknown>).suggestionId as string).trim()
      : "";

  // Practice Page = up to 2,500 words ≈ 3,500 tokens output. Case Result
  // ≈ 1,200 words ≈ 1,700 tokens. 8,192 max gives headroom for either.
  const maxTokens = brief.contentType === "case_result" ? 4096 : 8192;

  let userPrompt = buildBriefUserPrompt(brief);

  // Spanish (or any non-English) output directive.
  const langBlock = languageDirective(language);
  if (langBlock) {
    userPrompt += `\n\n---\n${langBlock}`;
  }

  // Glossary-ownership / "link don't redefine" enforcement: check the site
  // inventory for pages that already cover the brief's keywords + FAQ terms,
  // and instruct the model to link to them instead of writing competing
  // definitions. Fails soft when the inventory is empty.
  try {
    const overlapTerms = [
      brief.primaryKeyword,
      ...(brief.secondaryKeywords ?? []),
      ...(brief.faqQuestions ?? []),
    ].filter(Boolean);
    const overlap = await detectContentOverlap(overlapTerms);
    if (overlap.promptBlock) {
      userPrompt += `\n\n---\n${overlap.promptBlock}`;
    }
  } catch {
    /* no inventory / non-fatal */
  }

  // Authoritative internal link plan: the generator may use ONLY these confirmed
  // internal links and must not invent others. This is the "link plan into the
  // generator" connection — the URLs come from the Cluster Map via the brief.
  const linkPlan = brief.internalLinks ?? [];
  if (linkPlan.length > 0) {
    const planLines = linkPlan.map(
      (l) => `- ${l.anchor} → ${l.url}  (place in: ${l.section})`,
    );
    userPrompt +=
      `\n\n---\nAPPROVED INTERNAL LINK PLAN — these are the ONLY internal links you may use. ` +
      `Each is a confirmed live page. Use the given anchor text and place the link in the indicated section. ` +
      `Do NOT invent, guess, or add any other internal link (any relative URL or absolute URL to the firm's own website). ` +
      `You may still cite external authorities (statutes, courts, government sites) in prose.\n` +
      planLines.join("\n");
  }

  // Self-QA: bake the publishing checklist into the FIRST pass so the draft
  // already incorporates the elements the analyzer would otherwise flag after
  // the fact. This is the "integrate the fixes before the final draft" step —
  // imported content still gets the separate post-hoc analysis pass.
  userPrompt +=
    `\n\n---\nBEFORE YOU FINALIZE — silently self-check the draft against this checklist and fix any miss before returning it (do NOT output the checklist itself):\n` +
    `- The primary keyword "${brief.primaryKeyword}" appears in the H1, the first 100 words, and at least one H2.\n` +
    `- Secondary keywords are woven in naturally where they fit (no stuffing).\n` +
    `- The meta description is a single sentence of 155 characters or fewer.\n` +
    `- Every approved internal link is actually placed in its section, and no other internal links exist.\n` +
    `- Each section has a clear, scannable H2/H3 — no section is a wall of text.\n` +
    `- An FAQ section answers real search questions in a featured-snippet-friendly format.\n` +
    `- Statutes, deadlines, and figures are stated precisely or omitted — never guessed.\n` +
    `- The piece reads in KM's brand voice and ends with a clear next step / CTA.`;

  // Per-tenant system prompt (Phase 2). Falls back to the code-defined
  // KM_SYSTEM_PROMPT for the default tenant via getTenantConfig.
  const tenantConfig = await getTenantConfig();

  try {
    const msg = await getAnthropic().messages.create({
      model: CONTENT_LONG_FORM_MODEL,
      max_tokens: maxTokens,
      system: cachedSystemPrompt(tenantConfig.systemPrompt),
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

    const draftId = await autosave(brief, text, language);

    // Connection: advance the Production Board row this draft belongs to.
    // Without this, the board never learns a draft was created (draft_id stays
    // null, status stuck at 'brief') and Diana can't open the draft from there.
    if (draftId && suggestionId) {
      await linkPipelineDraft(suggestionId, draftId);
    }

    // Auto-readability check (runs after the response via after()).
    scheduleDraftAnalysis({
      draftId,
      body: text,
      title: brief.h1 || brief.metaTitle || brief.primaryKeyword,
      topic: brief.primaryKeyword,
      format: `km_${brief.contentType}`,
      template: `km_${brief.contentType}`,
      targetKeywords: [brief.primaryKeyword, ...(brief.secondaryKeywords ?? [])],
    });

    return NextResponse.json({
      draft_id: draftId,
      content: text,
      content_type: brief.contentType,
      practice_area: brief.practiceArea,
      language,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Anthropic request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Advance the Production Board (content_pipeline) row created from this
 * suggestion: link the draft and flip status brief→draft. Non-fatal — the
 * draft is already saved, so a failure here just means the board didn't move.
 * We never pull a 'published' item backwards.
 */
async function linkPipelineDraft(suggestionId: string, draftId: string): Promise<void> {
  const supabase = getSupabaseServer();
  if (!supabase) return;
  try {
    const tid = await resolveTenantId();
    await supabase
      .from("content_pipeline")
      .update({ draft_id: draftId, status: "draft" })
      .eq("tenant_id", tid)
      .eq("suggestion_id", suggestionId)
      .neq("status", "published");
  } catch {
    /* non-fatal — draft is saved regardless of board state */
  }
}

async function autosave(
  brief: KMPerPageBrief,
  body: string,
  language: ContentLanguage,
): Promise<string | null> {
  const supabase = getSupabaseServer();
  if (!supabase) return null;
  const tid = await resolveTenantId();
  try {
    const format = `km_${brief.contentType}`;
    const { data } = await supabase
      .from("content_drafts")
      .insert({
        tenant_id: tid,
        format,
        template: `km_${brief.contentType}`,
        topic: brief.primaryKeyword,
        practice_area:
          brief.practiceArea === "employment" ? "Employment Law" : "Commercial Collections",
        // The brief's H1 is the on-page title; fall back to meta title / keyword.
        title: brief.h1 || brief.metaTitle || brief.primaryKeyword,
        body,
        metadata: {
          km_brief: brief,
          km_content_type: KM_CONTENT_TYPE_LABELS[brief.contentType],
          hub_link: KM_HUB_LINKS[brief.practiceArea],
          language,
        },
        seo_brief: {
          primaryKeyword: brief.primaryKeyword,
          searchIntent: brief.searchIntent,
          pillarId: brief.pillarId,
          urlSlug: brief.urlSlug,
          metaTitle: brief.metaTitle,
          metaDescription: brief.metaDescription,
          h1: brief.h1,
          secondaryKeywords: brief.secondaryKeywords ?? [],
        },
      })
      .select("id")
      .single();
    return (data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}
