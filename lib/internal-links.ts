/**
 * Internal link plan builder — the "Brief → Cluster Map" connection.
 *
 * Given a brief's keywords + pillar, this asks the Cluster Map (site_pages, via
 * detectContentOverlap) which LIVE pages relate to the topic and turns the
 * result into a structured, reviewable link plan: a confirmed URL, suggested
 * anchor text, and the section each link belongs in.
 *
 * Cannibalization guard: a candidate page that already targets the brief's
 * exact primary keyword is NOT offered as a link (linking the new page to an
 * existing page on the same query is a cannibalization signal). It is returned
 * in `flagged` instead, so a reviewer sees it but the generator never does.
 *
 * The pillar page for the brief is always included — it is a known-live URL and
 * every blog/case result must link up to its pillar.
 */

import { detectContentOverlap } from "@/lib/content-overlap";
import {
  findPillar,
  type KMInternalLink,
  type KMPracticeArea,
} from "@/lib/km-content-system";
import { getPillars } from "@/lib/pillars-store";
import { listSitePages, type SitePage } from "@/lib/site-inventory";

export type LinkPlanInput = {
  primaryKeyword: string;
  secondaryKeywords?: string[];
  faqQuestions?: string[];
  pillarId?: string;
  practiceArea?: KMPracticeArea;
  /** The page being written (so it never links to itself). */
  excludeUrl?: string;
};

export type LinkPlanFlag = {
  url: string;
  title: string | null;
  reason: string;
};

export type LinkPlan = {
  links: KMInternalLink[];
  flagged: LinkPlanFlag[];
};

const normalize = (s: string) => s.trim().toLowerCase();
const normalizePath = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function sectionForPageType(pageType: string): string {
  if (pageType === "pillar") return "Pillar / CTA";
  if (pageType === "case_result") return "Proof / supporting";
  return "Body";
}

export async function buildLinkPlan(input: LinkPlanInput): Promise<LinkPlan> {
  const primaryNorm = normalize(input.primaryKeyword);
  const excludePath = input.excludeUrl ? normalizePath(input.excludeUrl) : null;

  const terms = [
    input.primaryKeyword,
    ...(input.secondaryKeywords ?? []),
    ...(input.faqQuestions ?? []),
  ].filter((t) => t && t.trim().length > 0);

  const overlap = await detectContentOverlap(terms, {
    excludeUrl: input.excludeUrl,
  }).catch(() => null);

  const links: KMInternalLink[] = [];
  const flagged: LinkPlanFlag[] = [];
  const seen = new Set<string>();

  for (const match of overlap?.matches ?? []) {
    const top = match.pages[0];
    if (!top) continue;
    const path = normalizePath(top.url);
    if (excludePath && path === excludePath) continue;

    // Cannibalization: an existing page already targets our primary keyword.
    if (normalize(match.term) === primaryNorm) {
      if (!flagged.some((f) => normalizePath(f.url) === path)) {
        flagged.push({
          url: top.url,
          title: top.title,
          reason:
            "Targets the same primary keyword — excluded from the link plan to avoid cannibalization.",
        });
      }
      continue;
    }

    if (seen.has(path)) continue;
    seen.add(path);
    links.push({
      url: top.url,
      anchor: top.title?.trim() || titleCase(match.term),
      section: sectionForPageType(top.page_type),
    });
  }

  // Always include the assigned pillar (known-live, required up-link).
  const pillar = input.pillarId
    ? findPillar(await getPillars(), input.pillarId)
    : undefined;
  if (pillar) {
    const pillarPath = normalizePath(pillar.url);
    if (
      (!excludePath || pillarPath !== excludePath) &&
      !seen.has(pillarPath)
    ) {
      seen.add(pillarPath);
      // Pillar leads the plan so it reads as the primary up-link.
      links.unshift({
        url: pillar.url,
        anchor: pillar.label,
        section: "Pillar / CTA",
      });
    }
  }

  return { links, flagged };
}

/**
 * Render an approved link plan as a generator-prompt block. Shared by every
 * content generator so the wording (and the "ONLY these links" constraint) is
 * identical everywhere. Returns "" when there are no links so callers can
 * append unconditionally.
 */
export function approvedLinkPlanBlock(links: KMInternalLink[]): string {
  if (!links.length) return "";
  const lines = links.map((l) => `- ${l.anchor} → ${l.url}  (place in: ${l.section})`);
  return (
    `APPROVED INTERNAL LINK PLAN — you MUST include EVERY one of these internal links, and these are the ONLY internal links you may use. ` +
    `Each is a confirmed live page on the firm's site. Use the given anchor text and place each link in the indicated section, woven naturally into the prose. ` +
    `Do NOT invent, guess, or add any other internal link (no other relative or katzmelinger.com URLs). ` +
    `You may still cite external authorities (statutes, courts, government sites) in prose.\n` +
    lines.join("\n")
  );
}

// ---------------------------------------------------------------------------
// Orphan fix — "which existing pages should link TO this orphan?"
//
// The internal-link audit (lib/internal-link-audit.ts) flags orphan pages: live
// pages that no other crawled page links to. This is the inverse of buildLinkPlan:
// instead of picking outbound targets for a page being written, it finds existing
// pages that already cover the orphan's topic and are therefore the natural place
// to add an inbound link, with a suggested anchor that describes the orphan.
// ---------------------------------------------------------------------------

export type OrphanLinkerSource = {
  url: string;
  title: string | null;
  page_type: string;
  /** The orphan-topic term this source page matched on. */
  matchedTerm: string;
};

export type OrphanLinkerSuggestion = {
  orphanUrl: string;
  orphanTitle: string | null;
  /** Suggested anchor text for the inbound link (describes the orphan). */
  anchor: string;
  /** Existing pages that cover the orphan's topic and should link to it. */
  sources: OrphanLinkerSource[];
};

/**
 * Turn a scraped <title> into usable anchor text: drop the "| Site Name" suffix
 * CMSes append, and decode the few HTML entities that show up in raw titles.
 */
function cleanAnchorText(t: string): string {
  const base = t.split(/\s+[|–—]\s+/)[0].trim() || t.trim();
  return base
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Derive a topic phrase from a URL's last path segment (slug). */
function slugToPhrase(u: string): string {
  try {
    const { pathname } = new URL(u);
    const seg = pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
    return seg
      .replace(/[-_]+/g, " ")
      .replace(/[^a-z0-9\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

export async function suggestOrphanLinkers(
  orphanUrl: string,
  opts?: { limit?: number },
): Promise<OrphanLinkerSuggestion> {
  const limit = opts?.limit ?? 5;
  const orphanPath = normalizePath(orphanUrl);

  let pages: SitePage[] = [];
  try {
    pages = await listSitePages();
  } catch {
    pages = [];
  }
  const orphan = pages.find((p) => normalizePath(p.url) === orphanPath) ?? null;

  const slugPhrase = slugToPhrase(orphanUrl);

  // Terms describing what the orphan is about — these drive the topical match.
  const terms = Array.from(
    new Set(
      [
        ...(orphan?.topics ?? []),
        orphan?.title ?? "",
        orphan?.h1 ?? "",
        slugPhrase,
      ]
        .map((t) => (t ?? "").trim())
        .filter((t) => t.length >= 4),
    ),
  );

  const anchor = cleanAnchorText(
    orphan?.title?.trim() ||
      orphan?.h1?.trim() ||
      (slugPhrase ? titleCase(slugPhrase) : "this page"),
  );

  if (terms.length === 0) {
    return { orphanUrl, orphanTitle: orphan?.title ?? null, anchor, sources: [] };
  }

  const overlap = await detectContentOverlap(terms, {
    excludeUrl: orphanUrl,
  }).catch(() => null);

  const sources: OrphanLinkerSource[] = [];
  const seen = new Set<string>();
  for (const match of overlap?.matches ?? []) {
    for (const page of match.pages) {
      const path = normalizePath(page.url);
      if (path === orphanPath || seen.has(path)) continue;
      seen.add(path);
      sources.push({
        url: page.url,
        title: page.title,
        page_type: page.page_type,
        matchedTerm: match.term,
      });
      if (sources.length >= limit) break;
    }
    if (sources.length >= limit) break;
  }

  return { orphanUrl, orphanTitle: orphan?.title ?? null, anchor, sources };
}
