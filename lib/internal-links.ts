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
  getPillarById,
  type KMInternalLink,
  type KMPracticeArea,
} from "@/lib/km-content-system";

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
  const pillar = input.pillarId ? getPillarById(input.pillarId) : undefined;
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
