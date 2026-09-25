/**
 * Quality scores are TARGETS, not gates (Diana item 3c, 21 September).
 *
 * "SEO and CASH below 75 must read as a soft note, not 'things to fix', and
 * Apply fix must not be expected to move a score. Separate findings to fix
 * (actionable) from quality scores (ratings)."
 *
 * The distinction this file encodes:
 *
 *   a FINDING is something specific and actionable — a missing keyword in the
 *   H1, a wrong figure, an absent disclaimer. It names a thing to change.
 *
 *   a SCORE is a rating of the finished piece. It moves as a side effect of
 *   fixing findings, and a reviewer chasing the number rather than the notes is
 *   being pointed at the wrong thing.
 *
 * Client-safe: constants and pure string helpers only, so both the analysis
 * card and the server-side scorers can share one definition.
 */

/** Below this, a score is worth a note. It is not a gate. */
export const SCORE_TARGET = 75;

/** Scores at or above this need no comment at all. */
export const SCORE_GOOD = 85;

export type ScoreTone = "good" | "fine" | "soft";

export function scoreTone(score: number | null | undefined): ScoreTone {
  if (typeof score !== "number") return "fine";
  if (score >= SCORE_GOOD) return "good";
  if (score >= SCORE_TARGET) return "fine";
  return "soft";
}

/**
 * How a below-target score should read to a reviewer: an observation, not an
 * instruction. Returns "" when the score needs no comment.
 */
export function scoreNote(label: string, score: number | null | undefined): string {
  if (scoreTone(score) !== "soft") return "";
  return `${label} is ${score}, under the ${SCORE_TARGET} target. Worth a look, not a blocker — clear the findings and the score follows.`;
}

/**
 * The CASH "Human" sub-score, said plainly (Diana 3c).
 *
 * "When CASH is low because the 'Human' sub-score is low, say plainly that it
 * 'reads as AI-written' rather than hiding it in a number." A reviewer can act
 * on that sentence; they cannot act on a 62.
 */
export function humanSubScoreNote(human: number | null | undefined): string {
  if (typeof human !== "number" || human >= SCORE_TARGET) return "";
  return "This reads as AI-written — generic phrasing, even rhythm, little firsthand specificity. Add a concrete detail, an example from a real matter, or a sentence only this firm could write.";
}
