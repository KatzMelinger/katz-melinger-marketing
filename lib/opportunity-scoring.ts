/**
 * Opportunity Scorer (intelligence-layer Step 5).
 *
 * Turns the signals gathered by Steps 1-4 into a single 0-100 priority score
 * per page decision, then buckets scores into high/medium/low. Kept as a pure
 * module (no I/O) so it's deterministic and unit-testable, and so the sync
 * route stays readable.
 *
 * Weighting follows the spec's factor list, heaviest first:
 *   - combined keyword volume            (up to 40)  — more searches = more upside
 *   - competitor strength (best rank)    (up to 20)  — competitor at #1 > #18
 *   - our-position delta                 (up to 20)  — bigger gap us↔them = bigger miss
 *   - action type                        (up to 10)  — create > optimize > update
 *   - number of competitors beating us   (up to 10)  — 3 firms winning > 1
 */

export type ActionLabel = "create" | "optimize" | "update";

export type ScoreInput = {
  searchVolume: number | null;
  /** Our organic rank; null/0 means we don't rank at all. */
  ourPosition: number | null;
  /** Best (lowest) competitor rank for the term. */
  competitorPosition: number | null;
  /** How many tracked competitors outrank us on this term. */
  competitorsBeatingUs: number | null;
  /** Step 3 output; may be null until cannibalization labeling has run. */
  actionLabel: ActionLabel | null;
};

export function scoreOpportunity(o: ScoreInput): number {
  let score = 0;

  // Combined keyword volume — highest weight, log-scaled so 27k doesn't dwarf
  // everything. log10(27101)*13 ≈ 57 → capped at 40.
  const vol = o.searchVolume ?? 0;
  score += vol > 0 ? Math.min(40, Math.round(Math.log10(vol + 1) * 13)) : 0;

  // Competitor strength: only counts when a competitor actually ranks 1-20.
  const cp = o.competitorPosition ?? 0;
  if (cp > 0 && cp <= 20) score += Math.round(((21 - cp) / 20) * 20);

  // Our-position delta: not ranking at all is the biggest gap; otherwise the
  // distance behind the best competitor.
  const op = o.ourPosition ?? 0;
  if (op <= 0) score += 20;
  else if (cp > 0) score += Math.min(20, Math.max(0, op - cp));

  // Action type — create is the most valuable net-new work.
  score +=
    o.actionLabel === "create"
      ? 10
      : o.actionLabel === "optimize"
        ? 6
        : o.actionLabel === "update"
          ? 3
          : 0;

  // Number of competitors beating us — saturates at 5.
  const n = o.competitorsBeatingUs ?? 0;
  score += Math.round((Math.min(Math.max(n, 0), 5) / 5) * 10);

  return Math.min(100, score);
}

export type Priority = "high" | "medium" | "low";

/**
 * Bucket scores into high/medium/low by percentile across the batch
 * (top 20% / middle 50% / bottom 30%), with an absolute floor on "high" so a
 * uniformly weak batch can't manufacture urgent items. Returns labels aligned
 * to the input order.
 */
export function assignPriorityLabels(
  scores: number[],
  opts: { highFloor?: number } = {},
): Priority[] {
  const highFloor = opts.highFloor ?? 45;
  const n = scores.length;
  if (n === 0) return [];
  const sorted = [...scores].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))]!;
  const highCut = at(0.8); // 80th percentile → top 20%
  const lowCut = at(0.3); //  30th percentile → bottom 30%
  return scores.map((s) => {
    if (s >= highCut && s >= highFloor) return "high";
    if (s <= lowCut) return "low";
    return "medium";
  });
}
