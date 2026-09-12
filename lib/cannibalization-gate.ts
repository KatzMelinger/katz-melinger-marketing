/**
 * Commercial-cannibalization gate (spec item 5).
 *
 * A blog draft can end up targeting the same commercial head term as an
 * existing service or practice-area page on the firm's own site — splitting
 * link equity and confusing search intent between two of the firm's own
 * pages. That's a content-strategy problem, and today nothing catches it
 * before a reviewer approves the draft.
 *
 * This is deliberately NOT lib/cannibalization.ts, which pulls DataForSEO's
 * ranked-keyword data for the whole domain (a heavier, quota-consuming,
 * SERP-position concern). This is a lightweight per-draft check against the
 * firm's own already-crawled page catalog (site_pages), reusing the same
 * keyword-equivalence matching as the duplicate-content guard
 * (lib/content-dedup.ts) so "NY overtime lawyer" and "New York overtime
 * attorney" are recognized as the same target rather than missed by an exact
 * string match.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { keywordsMatch } from "@/lib/content-dedup";

/** Page types that represent a commercial page the firm is trying to rank —
 *  the thing a blog (informational intent) shouldn't compete with. */
const COMMERCIAL_PAGE_TYPES = ["service_page", "practice_area"];

export type CannibalizationConflict = {
  /** Whichever candidate keyword/topic/title matched. */
  keyword: string;
  page: { url: string; title: string; pageType: string };
};

/** Only a blog (informational format) can cannibalize a service/practice-area
 *  page — a service page can't conflict with itself, and non-web formats
 *  (social, email) aren't in the site's page catalog to begin with. */
function isCannibalizableFormat(format: string | null | undefined): boolean {
  const f = (format ?? "").toLowerCase().trim();
  return f === "" || f === "blog" || f.includes("blog");
}

/**
 * Does this draft's target keyword/topic/title match an existing service or
 * practice-area page? Returns the first conflict found, or null — including
 * on any infra failure (fails OPEN: an unreachable DB must never itself
 * become the reason a draft gets held).
 */
export async function checkCannibalizationConflict(args: {
  tenantId: string;
  format: string | null;
  targetKeywords?: string[];
  topic?: string | null;
  title?: string | null;
}): Promise<CannibalizationConflict | null> {
  if (!isCannibalizableFormat(args.format)) return null;

  // Keywords first — they're the actual search target this draft was briefed
  // for. Topic/title are weaker fallbacks for a draft with no target keywords.
  const candidates = [...(args.targetKeywords ?? []), args.topic ?? "", args.title ?? ""].filter(
    (k) => k && k.trim().length >= 3,
  );
  if (candidates.length === 0) return null;

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("site_pages")
      .select("url, title, h1, page_type")
      .eq("tenant_id", args.tenantId)
      .in("page_type", COMMERCIAL_PAGE_TYPES)
      .limit(2000);
    if (error || !data) return null;

    const pages = data as Array<{
      url: string;
      title: string | null;
      h1: string | null;
      page_type: string;
    }>;
    for (const keyword of candidates) {
      for (const page of pages) {
        const label = page.title || page.h1 || "";
        if (!label) continue;
        if (keywordsMatch(keyword, label)) {
          return { keyword, page: { url: page.url, title: label, pageType: page.page_type } };
        }
      }
    }
    return null;
  } catch {
    return null; // fail open — see the doc comment above
  }
}
