/**
 * Who reviews a draft held for legal, and who signs it when it clears.
 *
 * Diana's §5. Legal Review holds route to the attorney who owns that practice
 * area, and the same attorney is the E-E-A-T reviewer whose WordPress profile
 * the published page is attributed to. One assignment, two purposes — which is
 * deliberate: the person who vouched for the law is the person whose name goes
 * on it.
 *
 *   Employment                        -> Nicole D. Grunfeld
 *   Commercial collections            -> Adam J. Sackowitz
 *   Judgment enforcement              -> Kenneth J. Katz
 *
 * NOTE: the collections pair is SWAPPED relative to Diana's §5 document,
 * which had Kenneth on commercial collections and Adam on judgment
 * enforcement. Corrected by Kenneth 2026-08-28. Flagged here because the
 * written spec still says the other way round, and someone reconciling the
 * two later should know this is deliberate rather than a transcription slip.
 *
 * The system models two practice areas (`employment`, `collections`) while
 * Diana names three, splitting collections into commercial collections and
 * judgment enforcement. Rather than fork the practice-area enum — which would
 * ripple through briefs, pillars, generation and the board — the split is
 * resolved here, from the pillar or topic, and falls back to the collections
 * owner when there is nothing to distinguish them.
 *
 * Backup: the three cover for each other. Any of them can clear a draft, so a
 * hold never waits on one person being available. That is a real requirement,
 * not a nicety — the whole point of the Legal Review stage is that drafts stop
 * moving until someone acts, and a stage that can only be cleared by one absent
 * person is how a queue silently stops.
 */

import { AUTHORS, type Author } from "./authors";

export type ReviewArea = "employment" | "commercial_collections" | "judgment_enforcement";

const REVIEWER_BY_AREA: Record<ReviewArea, string> = {
  employment: "nicole-d-grunfeld",
  commercial_collections: "adam-j-sackowitz",
  judgment_enforcement: "kenneth-j-katz",
};

export const REVIEW_AREA_LABEL: Record<ReviewArea, string> = {
  employment: "Employment",
  commercial_collections: "Commercial collections",
  judgment_enforcement: "Judgment enforcement",
};

/** Signals that a collections matter is specifically judgment enforcement. */
const JUDGMENT_ENFORCEMENT =
  // Both word orders and any verb form: "judgment enforcement" and "enforcing a
  // judgment" are the same practice, and requiring the bare stem "enforce" missed
  // every -ing and -ed form, which is how the phrase is usually written.
  /\b(?:judgment|judgement)\s+(?:enforc\w*|collect\w*|creditor)\b|\benforc\w*\s+(?:a\s+|the\s+|your\s+)?(?:judgment|judgement)\b|\brestraining\s+notice\b|\binformation\s+subpoena\b|\bwage\s+garnish\w*|\blevy\b|\bturnover\s+proceeding\b/i;

/**
 * Which of the three review areas does this piece belong to?
 *
 * `practiceArea` is the system's two-value column; the pillar and topic text
 * are what separate the two collections areas. When collections content gives
 * no enforcement signal it goes to commercial collections, because that is the
 * broader bucket and a misroute inside collections is cheap — the backup rule
 * means either attorney can clear it anyway.
 */
export function reviewAreaFor(input: {
  practiceArea?: string | null;
  pillarId?: string | null;
  topic?: string | null;
  title?: string | null;
}): ReviewArea {
  const area = (input.practiceArea ?? "").toLowerCase();
  if (area.includes("collection")) {
    const text = [input.pillarId, input.topic, input.title].filter(Boolean).join(" ");
    return JUDGMENT_ENFORCEMENT.test(text) ? "judgment_enforcement" : "commercial_collections";
  }
  return "employment";
}

function authorById(id: string): Author | undefined {
  return AUTHORS.find((a) => a.id === id);
}

/** The attorney who owns this review, or undefined if the roster is misconfigured. */
export function reviewerFor(input: Parameters<typeof reviewAreaFor>[0]): Author | undefined {
  return authorById(REVIEWER_BY_AREA[reviewAreaFor(input)]);
}

/**
 * Everyone who may clear this draft: the owning attorney first, then the other
 * two as backup. Order matters — the first is who gets notified, the rest are
 * who may act.
 */
export function reviewersFor(input: Parameters<typeof reviewAreaFor>[0]): Author[] {
  const owner = reviewerFor(input);
  const others = AUTHORS.filter((a) => a.id !== owner?.id);
  return owner ? [owner, ...others] : [...AUTHORS];
}

/** May this person clear a legal hold? Any of the three reviewing attorneys can. */
export function canClearLegalHold(email: string): boolean {
  const e = email.trim().toLowerCase();
  return AUTHORS.some((a) => a.email?.trim().toLowerCase() === e);
}
