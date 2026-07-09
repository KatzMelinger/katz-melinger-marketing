/**
 * FAQPage schema — the one structured-data type Huracán owns.
 *
 * katzmelinger.com runs Yoast SEO, which emits the base @graph (WebPage,
 * Article, Organization, BreadcrumbList, author) on every page. Yoast (free)
 * does NOT emit FAQPage, so that is Huracán's lane. See lib/schema-templates.ts
 * for the single-owner split.
 *
 * KM long-form drafts carry a dedicated "FAQ" section (see the section
 * templates in lib/km-content-system.ts). On publish we parse that section's
 * Q&A straight out of the draft body — deterministically, no AI call — and
 * queue a FAQPage JSON-LD fix so the WP plugin injects it. Parsing the body
 * verbatim keeps the schema answers matching the visible page text, which is
 * what Google requires for FAQ rich results (invented answers risk a manual
 * action).
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { normalizeDomain } from "@/lib/wp-autopilot";

export type FaqPair = { question: string; answer: string };

/** Strip the light markdown that shows up in headings/answers to plain text. */
function stripMd(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) -> text
    .replace(/[*_`#>]+/g, "") // emphasis / heading / quote markers
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull Q&A pairs out of a markdown draft's FAQ section. Returns [] when there
 * is no FAQ section or no parseable pairs — callers should treat an empty
 * result as "no FAQ schema for this page", never as an error.
 *
 * Handles the two shapes KM drafts use:
 *   A) sub-heading questions:  ### Can I be fired for…?  \n  Answer paragraph.
 *   B) bold questions:         **Can I be fired for…?**  Answer paragraph.
 */
export function extractFaqPairs(markdown: string): FaqPair[] {
  if (!markdown || !markdown.trim()) return [];
  const lines = markdown.split(/\r?\n/);

  // Locate the FAQ heading and its level.
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && /^(faq\b|frequently asked)/i.test(m[2])) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return [];

  // The FAQ section runs until the next heading at the same or higher level.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start + 1, end);

  // Pattern A — questions are sub-headings deeper than the FAQ heading.
  const subIdx: number[] = [];
  for (let i = 0; i < section.length; i++) {
    const m = section[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length > level) subIdx.push(i);
  }
  const pairs: FaqPair[] = [];
  if (subIdx.length >= 1) {
    for (let k = 0; k < subIdx.length; k++) {
      const qi = subIdx[k];
      const question = stripMd(section[qi].replace(/^#{1,6}\s+/, ""));
      const aEnd = k + 1 < subIdx.length ? subIdx[k + 1] : section.length;
      const answer = stripMd(section.slice(qi + 1, aEnd).join(" "));
      if (question && answer) pairs.push({ question, answer });
    }
    return dedupePairs(pairs);
  }

  // Pattern B — bold-line questions, each followed by an answer paragraph.
  let curQ: string | null = null;
  let curA: string[] = [];
  const flush = () => {
    if (curQ) {
      const answer = stripMd(curA.join(" "));
      const question = stripMd(curQ);
      if (question && answer) pairs.push({ question, answer });
    }
    curQ = null;
    curA = [];
  };
  for (const raw of section) {
    const line = raw.trim();
    if (!line) continue;
    const bold = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
    if (bold && bold[1].includes("?")) {
      flush();
      curQ = bold[1];
      if (bold[2]) curA.push(bold[2]);
    } else if (curQ) {
      curA.push(line);
    }
  }
  flush();
  return dedupePairs(pairs);
}

function dedupePairs(pairs: FaqPair[]): FaqPair[] {
  const seen = new Set<string>();
  const out: FaqPair[] = [];
  for (const p of pairs) {
    const key = p.question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Build FAQPage JSON-LD from Q&A pairs. */
export function buildFaqPageJsonLd(
  pairs: FaqPair[],
  pageUrl: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntityOfPage: pageUrl,
    mainEntity: pairs.map((p) => ({
      "@type": "Question",
      name: p.question,
      acceptedAnswer: { "@type": "Answer", text: p.answer },
    })),
  };
}

/**
 * Extract FAQ from a draft body and queue a FAQPage schema_jsonld fix for the
 * page's live URL. Idempotent per URL: clears any prior auto-queued FAQ schema
 * for this URL first, so re-publishing refreshes the FAQ instead of stacking
 * duplicate queue rows. Returns the number of Q&A pairs queued (0 = nothing to
 * do). Never throws for "no FAQ" — only for a genuine DB failure.
 */
export async function queueFaqPageSchema(args: {
  body: string;
  pageUrl: string;
  tenantId: string;
}): Promise<number> {
  const pairs = extractFaqPairs(args.body);
  // Need at least 2 real Q&A pairs for a credible FAQPage.
  if (pairs.length < 2) return 0;

  let parsed: URL;
  try {
    parsed = new URL(args.pageUrl);
  } catch {
    return 0;
  }
  const pageUrl = parsed.toString();
  const domain = normalizeDomain(parsed.host);
  const jsonld = buildFaqPageJsonLd(pairs, pageUrl);

  const sb = getSupabaseAdmin();

  // Replace any earlier auto-queued FAQ schema for this URL that hasn't been
  // applied yet, so the freshest FAQ wins and the queue stays clean. Manually
  // generated schema (a different metadata.source) is left untouched.
  await sb
    .from("wp_autopilot_recommendations")
    .delete()
    .eq("tenant_id", args.tenantId)
    .eq("page_url", pageUrl)
    .eq("fix_type", "schema_jsonld")
    .eq("status", "approved")
    .filter("metadata->>source", "eq", "faq_autopublish");

  const { error } = await sb.from("wp_autopilot_recommendations").insert({
    tenant_id: args.tenantId,
    domain,
    page_url: pageUrl,
    fix_type: "schema_jsonld",
    current_value: null,
    suggested_value: JSON.stringify(jsonld),
    rationale: `Add FAQPage structured data (${pairs.length} Q&A) so this page can earn FAQ rich results — Yoast does not emit FAQPage.`,
    status: "approved",
    metadata: { source: "faq_autopublish", pair_count: pairs.length },
  });
  if (error) throw new Error(error.message);

  return pairs.length;
}
