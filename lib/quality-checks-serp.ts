/**
 * The quality checks that need search data (Oct 20 spec, Task A8):
 *
 *   Search intent    the page type matches the dominant result type in the
 *                    top ten for the primary keyword ("Top results are
 *                    practice pages; this draft is a blog").
 *   Topic coverage   the People Also Ask questions for the keyword are
 *                    answered somewhere in the article.
 *
 * Information only until calibrated. Computed by Improve to Ready (one cached
 * DataForSEO call per keyword) and stored as metadata.quality_serp, so the
 * checklist never calls DataForSEO on its own.
 */
import type { DraftContent } from "./draft-frame";
import { coverage, intentTokens } from "./keyword-guard";
import type { QualityCheck } from "./quality-checks";

export type SerpData = { organic: { url: string; title: string; domain: string }[]; paa: string[]; fetchedAt: string };
export type QualitySerpRecord = { keyword: string; checked_at: string; checks: QualityCheck[]; uncoveredQuestions: string[] };

export function readQualitySerp(meta: Record<string, unknown> | null | undefined): QualitySerpRecord | null {
  const r = meta?.quality_serp as QualitySerpRecord | undefined;
  return r && Array.isArray(r.checks) ? r : null;
}

/** "practice" (a service or practice area page) or "blog" (an article), from the URL and title. */
export function resultType(url: string, title: string): "practice" | "blog" | "other" {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return "other";
  }
  const t = title.toLowerCase();
  if (/\/(blog|news|insights|articles?|resources|learn|library|posts?)\//.test(path) || /\/\d{4}\/\d{2}\//.test(path)) return "blog";
  if (/^(how|what|when|why|can|do|does|is|are|should)\b/.test(t) || /\?/.test(t)) return "blog";
  if (path === "/" || /(lawyer|attorney|practice|services?|law-firm|legal)/.test(path) || /\b(lawyers?|attorneys?|law firm)\b/.test(t)) return "practice";
  return "other";
}

export function serpQualityChecks(args: {
  keyword: string;
  content: DraftContent;
  format: string | null;
  serp: SerpData;
}): { checks: QualityCheck[]; uncoveredQuestions: string[] } {
  const { serp } = args;
  const source = `DataForSEO top 10 and People Also Ask for "${args.keyword}", ${serp.fetchedAt.slice(0, 10)}`;
  const checks: QualityCheck[] = [];

  // Search intent.
  const types = serp.organic.map((o) => resultType(o.url, o.title));
  const practice = types.filter((t) => t === "practice").length;
  const blog = types.filter((t) => t === "blog").length;
  const draftType = args.format === "km_practice_page" ? "practice" : "blog";
  const dominant = practice > blog && practice >= 5 ? "practice" : blog > practice && blog >= 5 ? "blog" : null;
  const label = (t: string) => (t === "practice" ? "practice pages" : "blog articles");
  checks.push({
    key: "search_intent",
    label: "Page type matches what ranks for the keyword",
    pass: !dominant || dominant === draftType,
    gap:
      dominant && dominant !== draftType
        ? `Top results are ${label(dominant)} (${dominant === "practice" ? practice : blog} of ${serp.organic.length}); this draft is a ${draftType === "practice" ? "practice page" : "blog"}.`
        : null,
    source,
    systemFixable: false,
  });

  // Topic coverage: People Also Ask questions answered in the article.
  const article = [args.content.h1, args.content.direct_answer, args.content.intro, ...args.content.sections.map((s) => `${s.h2} ${s.body}`), ...args.content.faq.map((f) => `${f.q} ${f.a}`)].join(" ");
  const have = intentTokens(article);
  const uncovered = serp.paa.filter((q) => coverage(intentTokens(q), have) < 0.6);
  checks.push({
    key: "topic_coverage",
    label: "People Also Ask questions covered",
    pass: uncovered.length === 0,
    gap: uncovered.length ? `Not covered: ${uncovered.slice(0, 3).map((q) => `"${q}"`).join(", ")}${uncovered.length > 3 ? ` and ${uncovered.length - 3} more` : ""} (People Also Ask).` : null,
    source,
    systemFixable: true,
  });
  return { checks, uncoveredQuestions: uncovered };
}
