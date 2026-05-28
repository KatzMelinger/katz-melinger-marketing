/**
 * Content-overlap detector — the systematic version of "search the site
 * before writing."
 *
 * NOTE: distinct from lib/cannibalization.ts, which is the SEO keyword
 * cannibalization detector (Semrush ranked-URL based). This one works off the
 * site_pages cluster map and is about *content duplication* — e.g. a glossary
 * section redefining "quid pro quo" when a dedicated blog post already exists.
 *
 * Given a set of terms (glossary terms, secondary keywords, the topic), it
 * finds existing pages that already cover each term and returns "link, don't
 * redefine" recommendations. Powers all four check points: Research Packet,
 * draft analysis, brief Block-4 auto-fill, and the generation prompt.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { SitePage } from "@/lib/site-inventory";

export type OverlapMatch = {
  term: string;
  pages: {
    url: string;
    title: string | null;
    page_type: string;
    pillar: string | null;
  }[];
};

export type ContentOverlapResult = {
  hasOverlap: boolean;
  matches: OverlapMatch[];
  /** Human-readable lines for the brief / draft-analysis UI. */
  recommendations: string[];
  /** Compact block to inject into the generation system prompt. */
  promptBlock: string;
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "what", "are", "how", "your", "you",
  "a", "an", "of", "in", "to", "is", "it", "on", "or", "at", "can", "do",
]);

function normalizeTerm(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function pageCoversTerm(page: SitePage, term: string): boolean {
  const normTerm = normalizeTerm(term);
  if (!normTerm || normTerm.length < 4) return false;
  const hay = `${page.title ?? ""} ${page.h1 ?? ""} ${(page.topics ?? []).join(" ")}`.toLowerCase();

  if (normTerm.includes(" ") && hay.includes(normTerm)) return true;

  const words = normTerm
    .split(" ")
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  if (words.length === 0) return false;
  return words.every((w) => hay.includes(w));
}

function rankType(t: string): number {
  switch (t) {
    case "pillar":
      return 0;
    case "service_page":
    case "practice_area":
      return 1;
    case "cluster":
      return 2;
    case "blog_post":
      return 3;
    case "case_result":
      return 4;
    default:
      return 5;
  }
}

export async function detectContentOverlap(
  terms: string[],
  opts?: { excludeUrl?: string },
): Promise<ContentOverlapResult> {
  const clean = Array.from(
    new Set(terms.map((t) => (t ?? "").trim()).filter((t) => t.length >= 4)),
  );
  if (clean.length === 0) {
    return { hasOverlap: false, matches: [], recommendations: [], promptBlock: "" };
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("site_pages")
    .select("id, url, title, h1, page_type, pillar, topics")
    .limit(1000);
  if (error || !data) {
    // No inventory yet — fail soft so callers never break.
    return { hasOverlap: false, matches: [], recommendations: [], promptBlock: "" };
  }
  const pages = data as SitePage[];
  const excludeUrl = opts?.excludeUrl ? opts.excludeUrl.replace(/\/$/, "") : null;

  const matches: OverlapMatch[] = [];
  for (const term of clean) {
    const hits = pages
      .filter((p) => (excludeUrl ? p.url.replace(/\/$/, "") !== excludeUrl : true))
      .filter((p) => pageCoversTerm(p, term))
      .map((p) => ({
        url: p.url,
        title: p.title,
        page_type: p.page_type,
        pillar: p.pillar,
      }))
      .sort((a, b) => rankType(a.page_type) - rankType(b.page_type))
      .slice(0, 3);
    if (hits.length > 0) matches.push({ term, pages: hits });
  }

  const recommendations = matches.map((m) => {
    const top = m.pages[0];
    return `"${m.term}" already has a page — link to it instead of redefining: ${top.title ?? top.url} (${top.url})`;
  });

  const promptBlock =
    matches.length === 0
      ? ""
      : [
          "EXISTING SITE COVERAGE — these terms already have dedicated pages. Do NOT write a full definition or competing section for them. Define each in ONE sentence and add an internal link to the existing page:",
          ...matches.map(
            (m) =>
              `- ${m.term} → ${m.pages[0].url}${
                m.pages.length > 1
                  ? ` (also: ${m.pages.slice(1).map((p) => p.url).join(", ")})`
                  : ""
              }`,
          ),
        ].join("\n");

  return {
    hasOverlap: matches.length > 0,
    matches,
    recommendations,
    promptBlock,
  };
}
