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
  EMPLOYMENT_PILLARS,
  COLLECTIONS_PILLARS,
  KM_CONTENT_TYPE_LABELS,
  KM_HUB_LINKS,
  KM_SYSTEM_PROMPT,
  validateBrief,
  type KMContentType,
  type KMPerPageBrief,
  type KMPracticeArea,
  type KMSearchIntent,
} from "@/lib/km-content-system";
import { getSupabaseServer } from "@/lib/supabase-server";
import { detectContentOverlap } from "@/lib/content-overlap";

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
    specialInstructions: asString(o.specialInstructions).trim() || undefined,
  };
}

function pillarMatchesPracticeArea(pillarId: string, area: KMPracticeArea): boolean {
  const pool = area === "employment" ? EMPLOYMENT_PILLARS : COLLECTIONS_PILLARS;
  return pool.some((p) => p.id === pillarId);
}

export async function POST(req: Request) {
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
  if (partial.practiceArea && partial.pillarId && !pillarMatchesPracticeArea(partial.pillarId, partial.practiceArea)) {
    errors.push("Pillar mapping does not match the selected practice area");
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: "Brief is incomplete", details: errors }, { status: 400 });
  }

  const brief = partial as KMPerPageBrief;

  // Practice Page = up to 2,500 words ≈ 3,500 tokens output. Case Result
  // ≈ 1,200 words ≈ 1,700 tokens. 8,192 max gives headroom for either.
  const maxTokens = brief.contentType === "case_result" ? 4096 : 8192;

  let userPrompt = buildBriefUserPrompt(brief);

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

  try {
    const msg = await getAnthropic().messages.create({
      model: CONTENT_LONG_FORM_MODEL,
      max_tokens: maxTokens,
      system: cachedSystemPrompt(KM_SYSTEM_PROMPT),
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = msg.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

    const draftId = await autosave(brief, text);

    return NextResponse.json({
      draft_id: draftId,
      content: text,
      content_type: brief.contentType,
      practice_area: brief.practiceArea,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Anthropic request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function autosave(brief: KMPerPageBrief, body: string): Promise<string | null> {
  const supabase = getSupabaseServer();
  if (!supabase) return null;
  try {
    const format = `km_${brief.contentType}`;
    const { data } = await supabase
      .from("content_drafts")
      .insert({
        format,
        template: `km_${brief.contentType}`,
        topic: brief.primaryKeyword,
        practice_area:
          brief.practiceArea === "employment" ? "Employment Law" : "Commercial Collections",
        body,
        metadata: {
          km_brief: brief,
          km_content_type: KM_CONTENT_TYPE_LABELS[brief.contentType],
          hub_link: KM_HUB_LINKS[brief.practiceArea],
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
