/**
 * Freshness classification — turns raw scanner flags (lib/freshness-check.ts)
 * into an actionable status by comparing each figure against the current
 * verified values (lib/current-facts.ts):
 *
 *   outdated → maps to a known figure whose current value differs (carries the
 *              suggested value so the reviewer can one-click apply it)
 *   verify   → litigated / past re-verification / a figure we can't map to a
 *              verified value — a human must confirm it (never auto-applied)
 *   current  → maps to a known figure and already matches — no action
 *
 * Bare years, threshold keywords, or context phrases that don't map to a fact
 * aren't independently actionable (the dollar figure in the same sentence carries
 * the check), so they don't produce a freshness item.
 */

import type { FreshnessFlag, FreshnessKind } from "./freshness-check";
import { matchCurrentFact, needsReVerification, type CurrentFact } from "./current-facts";

export type FreshnessStatus = "outdated" | "verify" | "current";

export type ClassifiedFreshnessFlag = {
  kind: FreshnessKind;
  match: string;
  sentence: string;
  status: FreshnessStatus;
  /** Backward-compatible fields the drawer already reads. */
  current_value?: string;
  current_label?: string;
  effective_date?: string;
  /** The value to write on "Apply update" — only set when status is outdated. */
  suggested_value?: string;
  /** Why it needs attention (e.g. "litigated — attorney must verify"). */
  reason?: string;
  /** current_facts id/fact_key this figure mapped to. */
  fact_key?: string;
};

/** First numeric value in a string, commas removed. "$1,275.00 per week" → 1275. */
function parseAmount(s: string): number | null {
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number.parseFloat(m[0]) : null;
}

/** Two money strings refer to the same amount (to the cent). */
function sameAmount(a: string, b: string): boolean {
  const x = parseAmount(a);
  const y = parseAmount(b);
  return x !== null && y !== null && Math.abs(x - y) < 0.005;
}

function classifyFlag(
  flag: FreshnessFlag,
  facts: CurrentFact[],
  asOf: Date,
): ClassifiedFreshnessFlag | null {
  const base = { kind: flag.kind, match: flag.match, sentence: flag.sentence };
  const fact = matchCurrentFact(flag, facts);

  if (!fact) {
    // A dollar figure we can't map to a verified value still needs a human to
    // confirm it isn't stale. Non-dollar tokens with no mapped fact aren't
    // independently actionable.
    if (flag.kind === "dollar_amount") {
      return { ...base, status: "verify", reason: "no verified value on file" };
    }
    return null;
  }

  const withFact = {
    ...base,
    current_value: fact.value,
    current_label: fact.label,
    effective_date: fact.effectiveDate,
    fact_key: fact.id,
  };

  // Never auto-apply a litigated or expired value — force a human check.
  if (fact.verifyOnly) {
    return { ...withFact, status: "verify", reason: "litigated — attorney must verify" };
  }
  if (needsReVerification(fact, asOf)) {
    return { ...withFact, status: "verify", reason: "past re-verify date — re-confirm" };
  }

  // Only a dollar figure can be compared value-to-value.
  if (flag.kind === "dollar_amount") {
    return sameAmount(flag.match, fact.value)
      ? { ...withFact, status: "current" }
      : { ...withFact, status: "outdated", suggested_value: fact.value };
  }

  // A year / threshold keyword that maps to a healthy fact is informational —
  // the actual number is validated via its own dollar flag.
  return { ...withFact, status: "current" };
}

/**
 * Classify every scanner flag against the current facts. Drops non-actionable
 * tokens; the result is what gets stored on the draft and gates approval.
 */
export function classifyFreshness(
  flags: FreshnessFlag[],
  facts: CurrentFact[],
  asOf: Date = new Date(),
): ClassifiedFreshnessFlag[] {
  const classified: ClassifiedFreshnessFlag[] = [];
  for (const flag of flags) {
    const c = classifyFlag(flag, facts, asOf);
    if (c) classified.push(c);
  }
  // The dollar figure is the actionable unit. A threshold keyword or year that
  // maps to the same fact is redundant with it — drop it so the card and the
  // gate count show one row per figure, not two.
  const dollarFactKeys = new Set(
    classified.filter((f) => f.kind === "dollar_amount" && f.fact_key).map((f) => f.fact_key),
  );
  return classified.filter(
    (f) => f.kind === "dollar_amount" || !f.fact_key || !dollarFactKeys.has(f.fact_key),
  );
}

/** Flags that block approval — everything except already-current figures. */
export function unresolvedFreshness(
  flags: ClassifiedFreshnessFlag[],
): ClassifiedFreshnessFlag[] {
  return flags.filter((f) => f.status !== "current");
}

/**
 * Stable identity for a flag, shared by the drawer (per-figure resolution) and
 * the server gate (matching a client "verified" attestation). Must be computed
 * the same way on both sides.
 */
export function freshnessKey(f: {
  fact_key?: string;
  match?: string;
  sentence?: string;
}): string {
  return `${f.fact_key ?? ""}|${f.match ?? ""}|${(f.sentence ?? "").slice(0, 48)}`;
}

/**
 * Figures still blocking approval: outdated (a stale value is still in the body)
 * or verify not among the reviewer's confirmations. "current" never blocks.
 * Outdated is body-derived, so it can't be waved through with a stale attestation.
 */
export function outstandingFreshness(
  flags: ClassifiedFreshnessFlag[],
  verifiedKeys: Set<string> = new Set(),
): ClassifiedFreshnessFlag[] {
  return flags.filter(
    (f) => f.status !== "current" && !(f.status === "verify" && verifiedKeys.has(freshnessKey(f))),
  );
}
