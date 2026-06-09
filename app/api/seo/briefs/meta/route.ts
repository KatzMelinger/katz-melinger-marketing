/**
 * POST /api/seo/briefs/meta — AI-draft a meta title + description for a brief.
 *
 * Backs the KM Brief Wizard's "Draft with AI" button so the reviewer doesn't
 * hand-write meta tags. Returns a title (~50–60 chars) and a description
 * (<=155 chars) built from the chosen keywords, in the brief's output language.
 * Uses the cheap short-form model — this is a tiny, structured generation.
 */

import { NextResponse } from "next/server";

import {
  CONTENT_SHORT_FORM_MODEL,
  extractJSON,
  getAnthropic,
} from "@/lib/anthropic";
import { normalizeLanguage } from "@/lib/content-language";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const primaryKeyword = asString(body.primaryKeyword);
  if (!primaryKeyword) {
    return NextResponse.json(
      { error: "primaryKeyword is required" },
      { status: 400 },
    );
  }
  const secondaryKeywords = Array.isArray(body.secondaryKeywords)
    ? (body.secondaryKeywords as unknown[]).filter(
        (s): s is string => typeof s === "string",
      )
    : [];
  const practiceArea = asString(body.practiceArea) || "employment";
  const contentType = asString(body.contentType) || "blog_post";
  const h1 = asString(body.h1);
  const language = normalizeLanguage(body.language);
  const spanish = language === "es";

  const firmName = "Katz Melinger PLLC";
  const areaLabel =
    practiceArea === "collections" ? "commercial collections" : "employment law";

  const prompt = [
    `You are writing SEO meta tags for a ${areaLabel} ${contentType.replace("_", " ")} for the law firm ${firmName}.`,
    `Primary keyword: "${primaryKeyword}".`,
    secondaryKeywords.length
      ? `Secondary keywords: ${secondaryKeywords.join(", ")}.`
      : "",
    h1 ? `Page H1: "${h1}".` : "",
    "",
    "Return ONLY a JSON object with two fields:",
    `- "metaTitle": a compelling page title, 50–60 characters, includes the primary keyword, ends with " | ${firmName}" if it fits.`,
    `- "metaDescription": a benefit-driven description, MAXIMUM 155 characters, includes the primary keyword naturally, written to earn the click. Never exceed 155 characters.`,
    spanish
      ? "Write BOTH fields in natural, professional Spanish (es-US), formal register (usted). Keep the firm name in English."
      : "",
    "",
    'Example: {"metaTitle": "...", "metaDescription": "..."}',
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const msg = await getAnthropic().messages.create({
      model: CONTENT_SHORT_FORM_MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = msg.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = extractJSON<{
      metaTitle?: string;
      metaDescription?: string;
    }>(text);

    const metaTitle = asString(parsed.metaTitle);
    let metaDescription = asString(parsed.metaDescription);
    // Hard cap to honor the on-page limit even if the model overshoots.
    if (metaDescription.length > 155) {
      metaDescription = metaDescription.slice(0, 155).trim();
    }
    return NextResponse.json({ metaTitle, metaDescription });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Meta generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
