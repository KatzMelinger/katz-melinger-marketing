/**
 * SEO and AEO quality checks (Oct 20 spec, Task A8): specific checks that
 * name the gap, instead of a score. Information only until calibrated
 * against the firm's performing pages (the spec: a check that fails more
 * than 20 percent of them has the wrong threshold).
 *
 * These are the checks that need only the article and its metadata. The ones
 * that need search data (search intent and topic coverage from the top ten
 * results and People Also Ask) are in lib/quality-checks-serp.ts and add to
 * this list when that data is available.
 *
 * Improve to Ready (Task A9) uses the same list to plan: every failing check
 * here is something the system can fix itself.
 */
import type { DraftContent } from "./draft-frame";
import { internalLinks, MIN_INTERNAL_LINKS } from "./required-elements";
import { reviewAreaForDraft, type DraftForFrame } from "./draft-frame-server";
import { draftPrimaryKeyword } from "./draft-uniqueness";

export type QualityKey = "direct_answer" | "keyword_placement" | "faq" | "signs" | "internal_links" | "schema" | "search_intent" | "topic_coverage";

export type QualityCheck = {
  key: QualityKey;
  label: string;
  pass: boolean;
  /** The exact gap, when it fails. */
  gap: string | null;
  /** Where the data comes from, and its date when external. */
  source: string;
  /** Improve to Ready can close this gap itself. */
  systemFixable: boolean;
};

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const plain = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_#>`]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** "employment attorney nyc" is in the text when every word (or its plural / NY form) is. */
export function keywordIn(keyword: string, text: string): boolean {
  const t = ` ${plain(text)} `;
  const tokens = plain(keyword).split(" ").filter((w) => w.length > 2 || /^(ny|nj)$/.test(w));
  if (!tokens.length) return false;
  return tokens.every((w) => {
    const variants = [w, w.replace(/s$/, ""), `${w}s`];
    if (w === "nyc") variants.push("new york city", "new york");
    if (w === "ny") variants.push("new york");
    if (w === "nj") variants.push("new jersey");
    if (w === "lawyer" || w === "lawyers") variants.push("attorney", "attorneys");
    if (w === "attorney" || w === "attorneys") variants.push("lawyer", "lawyers");
    return variants.some((v) => t.includes(` ${v} `) || t.includes(` ${v}.`) || t.includes(` ${v},`) || t.includes(` ${v}?`) || t.includes(` ${v}:`));
  });
}

export function practiceSigns(practice: "employment" | "collections" | null): string {
  return practice === "collections" ? "Signs a business debt is worth pursuing in court" : "Signs you may have a case";
}

/** List items in a section body ("- ", "* ", "1. "). */
function listItems(body: string): number {
  return body.split("\n").filter((l) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(l)).length;
}

export function qualityChecks(args: {
  content: DraftContent;
  keyword: string | null;
  metaTitle: string | null;
  slug: string | null;
  practice: "employment" | "collections" | null;
  hasFaqSchema: boolean;
}): QualityCheck[] {
  const { content, keyword } = args;
  const out: QualityCheck[] = [];
  const add = (key: QualityKey, label: string, gap: string | null, systemFixable: boolean, source = "the article") =>
    out.push({ key, label, pass: gap === null, gap, source, systemFixable });

  // Direct answer: 60 words or fewer, directly under the H1.
  const da = content.direct_answer.trim();
  add(
    "direct_answer",
    "Direct answer under the H1 (60 words or fewer)",
    !da ? "No direct answer under the H1." : words(da) > 60 ? `The direct answer is ${words(da)} words; 60 or fewer.` : null,
    true,
  );

  // Keyword placement: H1, meta title, slug, first 100 words.
  if (keyword) {
    const first100 = [content.direct_answer, content.intro].join(" ").split(/\s+/).slice(0, 100).join(" ");
    const missing: string[] = [];
    if (!keywordIn(keyword, content.h1)) missing.push("H1");
    if (!args.metaTitle || !keywordIn(keyword, args.metaTitle)) missing.push("meta title");
    if (!args.slug || !keywordIn(keyword, args.slug.replace(/[-_/]+/g, " "))) missing.push("slug");
    if (!keywordIn(keyword, first100)) missing.push("first 100 words");
    add("keyword_placement", "Primary keyword in H1, meta title, slug and first 100 words", missing.length ? `"${keyword}" is missing from the ${missing.join(", ")}.` : null, true);
  }

  // FAQ: at least five questions, each answered in 80 words or fewer.
  const long = content.faq.filter((f) => words(f.a) > 80).length;
  add(
    "faq",
    "FAQ: at least 5 questions, answers of 80 words or fewer",
    content.faq.length < 5
      ? `${content.faq.length} FAQ question${content.faq.length === 1 ? "" : "s"}; at least 5.`
      : long
        ? `${long} FAQ answer${long === 1 ? " is" : "s are"} over 80 words.`
        : null,
    true,
  );

  // Do I have a case: at least five concrete signs (brand rule, 2026-10-15).
  const signs = content.sections.find((s) => s.kind === "signs_you_may_have_a_case");
  add(
    "signs",
    `"${practiceSigns(args.practice)}" section with at least 5 signs`,
    !signs ? `No "${practiceSigns(args.practice)}" section.` : listItems(signs.body) < 5 ? `The signs section lists ${listItems(signs.body)}; at least 5.` : null,
    true,
  );

  // Internal links in the article (the byline and disclaimer links are frame).
  const article = [content.direct_answer, content.intro, ...content.sections.map((s) => s.body), ...content.faq.map((f) => f.a)].join("\n");
  const n = internalLinks(article).length;
  add("internal_links", `At least ${MIN_INTERNAL_LINKS} internal links`, n < MIN_INTERNAL_LINKS ? `${n} internal link${n === 1 ? "" : "s"}; ${MIN_INTERNAL_LINKS} required.` : null, true);

  // Schema: FAQPage from the FAQ (Article comes from Yoast).
  add("schema", "FAQPage schema from the FAQ", content.faq.length > 0 && !args.hasFaqSchema ? "The FAQ has no FAQPage schema yet (rebuilt on the next save)." : null, true, "metadata.schema_jsonld");

  return out;
}

/** One line per failing check, for the Ready checklist's information notes. */
export function qualityNotes(checks: QualityCheck[]): string[] {
  return checks.filter((c) => !c.pass).map((c) => `Quality (information): ${c.gap} [${c.source}]`);
}

/** The checks for one draft, from its stored article and metadata. */
export function qualityForDraft(d: Pick<DraftForFrame, "metadata" | "title" | "topic" | "practice_area">, content: DraftContent): QualityCheck[] {
  const meta = d.metadata ?? {};
  const kb = (meta.km_brief as Record<string, unknown> | undefined) ?? {};
  const str = (...v: unknown[]) => (v.find((x) => typeof x === "string" && x.trim()) as string | undefined) ?? null;
  const area = reviewAreaForDraft({ title: d.title, topic: d.topic ?? null, practice_area: d.practice_area ?? null, metadata: meta });
  return qualityChecks({
    content,
    keyword: draftPrimaryKeyword(meta),
    metaTitle: str(meta.metaTitle, kb.metaTitle),
    slug: str(meta.urlSlug, meta.slug, kb.urlSlug),
    practice: area === "employment" ? "employment" : area ? "collections" : null,
    hasFaqSchema: (meta.schema_jsonld as { "@type"?: string } | null)?.["@type"] === "FAQPage",
  });
}
