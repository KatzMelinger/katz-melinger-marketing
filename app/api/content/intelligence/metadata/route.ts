/**
 * POST /api/content/intelligence/metadata
 *   body: { topic: string, pageType?: "blog_post" | "landing_page" | "service_page" | "guide" }
 *
 * Generates a complete SEO package for a planned piece of content:
 * meta title, meta description, URL slug, primary + secondary keywords,
 * Open Graph metadata, schema type, internal link suggestions, header
 * outline, target word count, and on-page optimization tips.
 *
 * Use this before writing — paste the output into your CMS / draft.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirmContext } from "@/lib/firm-context";
import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { guardUser } from "@/lib/supabase-route";
import { getTenantConfig } from "@/lib/tenant-config";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const topic = (body?.topic as string | undefined)?.trim();
  const pageType = (body?.pageType as string | undefined) ?? "blog_post";
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });

  const [firm, cfg] = await Promise.all([getFirmContext(), getTenantConfig()]);
  const domain = cfg.seoDomain;

  const system = `You are an SEO strategist auditing ${domain} — a law firm. ${firm}

Apply Google's E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) guidelines, especially important since legal content is YMYL (Your Money or Your Life). Apply local SEO best practices for the firm's target market.`;

  const user = `Generate a complete SEO package for a ${pageType} about: "${topic}"

Return JSON only:
{
  "metaTitle": "Under 60 characters; primary keyword near the start",
  "metaDescription": "Under 155 characters; compelling, includes a soft CTA",
  "urlSlug": "hyphenated-lowercase-slug",
  "primaryKeyword": "the main keyword to rank for",
  "secondaryKeywords": ["3-5 related keywords"],
  "ogTitle": "Open Graph title for social previews",
  "ogDescription": "Open Graph description for social previews",
  "schemaType": "the most appropriate schema.org type (e.g. LegalService, FAQPage, Article)",
  "internalLinkSuggestions": ["existing pages on ${domain} to link to/from"],
  "headerOutline": ["H1: ...", "H2: ...", "H2: ...", "H3: ..."],
  "targetWordCount": <recommended word count number>,
  "seoTips": ["3-5 specific on-page optimization tips for this topic"]
}`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const metadata = extractJSON(text);
    return NextResponse.json({ metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate metadata";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
