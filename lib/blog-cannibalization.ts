/**
 * Does this draft compete with a page the firm has already published?
 *
 * Diana's item 17 (D4 in the September brief). The QA panel said
 * "Cannibalization: Not checked" on every blog, which is exactly what the code
 * said too: `cannibalizationConfirmed` was a checkbox a reviewer ticked, and
 * `unchecked` is documented as advisory and never blocking. So a new blog could
 * be written against the same Google query as a live service page, and nothing
 * anywhere would say so.
 *
 * The other cannibalization engine (lib/cannibalization.ts) is a different
 * thing and does not answer this. It pulls DataForSEO rank data to find pages
 * that ALREADY compete in the SERPs — it has no view of an unpublished draft,
 * and by the time it can see one the damage is done.
 *
 * THE RULE, AND WHY IT NEEDS INTENT
 *
 * Service pages own commercial head terms; blogs stay informational. So a match
 * on its own is not a conflict — a blog explaining what unpaid wages are SHOULD
 * cover the same subject as the service page that sells help with them. What
 * makes it a conflict is a blog going after the commercial query: "unpaid wages
 * lawyer NYC" has one right answer on this site, and it is not a blog post.
 *
 * Hence two conditions, not one: a live page matches the target keyword, AND
 * the keyword reads as commercial or proof intent. Informational drafts pass
 * even when a service page covers the subject, which is the normal, healthy
 * case and must not be flagged.
 *
 * Matching reuses the registry's semantic key (synonym-, word-order- and
 * market-geo-invariant), so "unpaid wages lawyer NYC" and "NYC unpaid wage
 * attorney" are one target rather than two.
 */

import { keywordsMatch, semanticKey } from "./content-dedup";
import { fingerprintFinding, type NormalizedFinding } from "./content-findings";
import { listSitePages, type SitePage, type SitePageType } from "./site-inventory";
import { inferIntent } from "./strategy-engine";

/** Page types that legitimately own a commercial head term. */
const OWNING_TYPES: ReadonlySet<SitePageType> = new Set<SitePageType>([
  "service_page",
  "pillar",
  "practice_area",
  "cluster",
]);

export type CannibalConflict = {
  /** The live page that already targets this term. */
  url: string;
  title: string;
  pageType: SitePageType;
  /** Which of the draft's target keywords collided. */
  keyword: string;
  /**
   * Whether the owning page is a service page (the draft must yield and link)
   * or another blog (the two need differentiating or consolidating).
   */
  kind: "service_page" | "blog_post";
};

export type CannibalResult = {
  /** "unchecked" only when the check could not run at all. */
  status: "clear" | "conflict" | "unchecked";
  conflicts: CannibalConflict[];
  findings: NormalizedFinding[];
  /** Live pages the check compared against. 0 means the inventory is empty. */
  pagesScanned: number;
};

/** Every string a live page might be targeting a term with. */
function pageTerms(p: SitePage): string[] {
  return [p.title, p.h1, ...(p.topics ?? [])].filter(
    (t): t is string => typeof t === "string" && !!t.trim(),
  );
}

/**
 * The anchor text to link the owning page with.
 *
 * The commercial keyword itself, per Diana: the blog yields the query AND hands
 * its authority to the page that should rank for it. A generic "learn more"
 * anchor would do the first half and waste the second.
 */
export function conflictAnchor(c: CannibalConflict): string {
  return c.keyword;
}

/**
 * Run the check for one draft.
 *
 * Returns `unchecked` — never `clear` — when the site inventory is empty or
 * unreadable. "We found nothing" and "we could not look" are different answers,
 * and reporting the second as the first is how a green panel comes to mean
 * nothing. `unchecked` is advisory by the existing rules, so an empty inventory
 * does not block anybody; it just stops claiming the draft is clear.
 */
export async function checkBlogCannibalization(args: {
  targetKeywords: readonly string[];
  /** The draft's own live URL, if it has one — never conflicts with itself. */
  selfUrl?: string | null;
  title?: string | null;
}): Promise<CannibalResult> {
  const keywords = [...new Set(args.targetKeywords.map((k) => (k ?? "").trim()).filter(Boolean))];
  if (!keywords.length) {
    return { status: "unchecked", conflicts: [], findings: [], pagesScanned: 0 };
  }

  let pages: SitePage[];
  try {
    pages = await listSitePages();
  } catch (e) {
    console.warn("[blog-cannibalization] could not read the site inventory:", e);
    return { status: "unchecked", conflicts: [], findings: [], pagesScanned: 0 };
  }
  if (!pages.length) {
    return { status: "unchecked", conflicts: [], findings: [], pagesScanned: 0 };
  }

  const self = (args.selfUrl ?? "").trim().toLowerCase().replace(/\/+$/, "");
  const conflicts: CannibalConflict[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    // Only a query someone would type to HIRE is a conflict. An informational
    // draft covering the same subject is the intended arrangement.
    const intent = inferIntent({
      clusterName: args.title ?? keyword,
      primaryKeyword: keyword,
      secondaryKeywords: [],
    });
    if (intent === "informational") continue;

    for (const page of pages) {
      const pageUrl = (page.url ?? "").trim().toLowerCase().replace(/\/+$/, "");
      if (!pageUrl || (self && pageUrl === self)) continue;
      if (!OWNING_TYPES.has(page.page_type) && page.page_type !== "blog_post") continue;
      if (!pageTerms(page).some((t) => keywordsMatch(t, keyword))) continue;

      // One conflict per (page, keyword) — a page whose title and h1 both match
      // is still one competing page.
      const dedupeKey = `${pageUrl}::${semanticKey(keyword)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      conflicts.push({
        url: page.url,
        title: page.title || page.h1 || page.url,
        pageType: page.page_type,
        keyword,
        kind: OWNING_TYPES.has(page.page_type) ? "service_page" : "blog_post",
      });
    }
  }

  return {
    status: conflicts.length ? "conflict" : "clear",
    conflicts,
    findings: conflicts.map(toFinding),
    pagesScanned: pages.length,
  };
}

/**
 * A conflict as a finding. `critical` so it maps to a blocker under the item-12
 * severity model and holds approval — Diana's "it must gate, not only report".
 */
function toFinding(c: CannibalConflict): NormalizedFinding {
  const isService = c.kind === "service_page";
  return {
    fingerprint: fingerprintFinding("seo", "cannibalization", `${c.url}::${c.keyword}`),
    source: "seo",
    ruleId: "cannibalization",
    severity: "critical",
    title: isService
      ? `"${c.keyword}" is already owned by a service page`
      : `"${c.keyword}" is already targeted by another blog post`,
    detail: `${c.title} — ${c.url}`,
    excerpt: c.keyword,
    fix: isService
      ? `Reposition this draft to informational intent and link "${c.keyword}" to ${c.url}, so the service page keeps the commercial query.`
      : `Two blogs competing for one query split the ranking. Differentiate the angle, or consolidate into ${c.url}.`,
  };
}

/**
 * Turn the first plain-text mention of `anchor` into a markdown link.
 *
 * Returns null when it cannot be done, rather than a mangled body: no mention
 * to link, or the page is already linked. The lookbehind keeps it from nesting
 * a link inside an existing one, which is the failure that produces
 * `[[text](a)](b)` and breaks the render.
 *
 * Pure, so the caller decides whether to persist it.
 */
export function linkFirstMention(body: string, anchor: string, url: string): string | null {
  if (!body || !anchor.trim() || !url.trim()) return null;
  if (body.includes(`](${url})`)) return null;
  const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<!\\[)\\b(${esc})\\b`, "i");
  if (!re.test(body)) return null;
  return body.replace(re, `[$1](${url})`);
}
