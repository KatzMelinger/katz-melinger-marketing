/**
 * Search-intent vocabulary and keyword-hygiene checks shared by the clustering
 * engine and every content-creation entry point.
 *
 * Two keywords that share a topic but not an INTENT are two different pages.
 * "pressured to retire because of age in new york" (someone trying to understand
 * what is happening to them) and "executive secured a strong exit new york"
 * (someone looking for proof the firm gets results) are a blog and a case result,
 * not one page — and never one comma-joined string.
 *
 * Lives in its own module because the same rules have to hold at BOTH entry
 * points that produce keywords (the Opportunity Radar's cluster suggestions and
 * "new brief from scratch"), plus the draft-generation gate. Fixing it in one
 * button would leave the other two broken.
 *
 * Intent labels come from the existing DataForSEO sync (seo_opportunities.intent)
 * — the same four-category taxonomy Semrush publishes. Nothing new to integrate.
 */

import type { KMContentType } from "@/lib/km-content-system";

/** The four standard search-intent categories carried on a tracked keyword. */
export type SearchIntent =
  | "informational"
  | "commercial"
  | "transactional"
  | "navigational";

export const SEARCH_INTENT_LABELS: Record<SearchIntent, string> = {
  informational: "Informational",
  commercial: "Commercial",
  transactional: "Transactional",
  navigational: "Navigational",
};

/**
 * Intent → KM content type.
 *
 * Commercial maps to Case Result because a commercial-intent reader is
 * researching and comparing before deciding, which is exactly what a case
 * result page is for: proving the firm delivers outcomes before the reader
 * calls. Transactional maps to Practice Page because that reader is ready to
 * book a consultation.
 *
 * Navigational is null on purpose — it is mostly branded search and should
 * route to an existing hub page rather than generate new content.
 */
export const INTENT_TO_CONTENT_TYPE: Record<SearchIntent, KMContentType | null> = {
  informational: "blog_post",
  commercial: "case_result",
  transactional: "practice_page",
  navigational: null,
};

/** KM content type → the intent it serves. Inverse of the map above. */
export const CONTENT_TYPE_TO_INTENT: Record<KMContentType, SearchIntent> = {
  blog_post: "informational",
  case_result: "commercial",
  practice_page: "transactional",
};

const INTENT_ALIASES: Record<string, SearchIntent> = {
  i: "informational",
  info: "informational",
  informational: "informational",
  c: "commercial",
  commercial: "commercial",
  "commercial investigation": "commercial",
  t: "transactional",
  transactional: "transactional",
  n: "navigational",
  navigational: "navigational",
  brand: "navigational",
  branded: "navigational",
};

/**
 * Coerce a raw intent value (DataForSEO label, single letter, or free text)
 * into the canonical vocabulary. Returns null when it can't be resolved — an
 * unknown intent must never silently become "informational", because that would
 * quietly re-enable the mixed-intent clustering this module exists to stop.
 */
export function normalizeIntent(raw: unknown): SearchIntent | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return INTENT_ALIASES[key] ?? null;
}

/** KM's narrower on-page intent vocabulary (KMSearchIntent) for a given intent. */
export function kmSearchIntentFor(
  intent: SearchIntent,
): "informational" | "commercial" | "proof" {
  if (intent === "informational") return "informational";
  if (intent === "commercial") return "proof";
  return "commercial";
}

/**
 * True when a keyword string is a clustering failure rather than a real
 * keyword: a comma joining two or more full phrases.
 *
 * Conservative on purpose — a trailing single-word qualifier ("wage theft, nyc")
 * is left alone, because rejecting those would block legitimate briefs. Only a
 * comma joining two multi-word phrases is treated as a merge artifact.
 */
export function isCompoundKeyword(keyword: string): boolean {
  const parts = (keyword ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return false;
  const multiWord = parts.filter((p) => p.split(/\s+/).filter(Boolean).length >= 2);
  return multiWord.length >= 2;
}

/**
 * Split a merged keyword back into its constituent phrases. Used to recover
 * usable keywords from an already-merged string instead of discarding it.
 */
export function splitCompoundKeyword(keyword: string): string[] {
  return (keyword ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * The single clean primary keyword for a brief, or null when the input can't
 * produce one. Rejects compounds outright rather than silently taking the first
 * half — the caller has to decide which intent it meant.
 */
export function resolvePrimaryKeyword(...candidates: (string | null | undefined)[]): string | null {
  for (const raw of candidates) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    if (isCompoundKeyword(value)) return null;
    return value;
  }
  return null;
}
