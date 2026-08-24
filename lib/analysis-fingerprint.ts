/**
 * What an analysis was computed against — and therefore whether it can be
 * trusted right now.
 *
 * A `content_analyses` row records scores but never recorded the input that
 * produced them. That is fine while nothing changes, and wrong the moment
 * something does. Two failures came from it:
 *
 *   1. Edited body, unchanged score. The panel kept showing the pre-edit number
 *      with findings pointing at sentences that no longer existed.
 *   2. Retired engine, unchanged score. When READABILITY_RULES_ENGINE went to
 *      production the meaning of `readability_score` changed from Flesch
 *      reading-ease to share-of-rules-passed. Nothing re-scored, so 62 of the
 *      71 scored drafts kept displaying a Flesch number in a UI labelled for
 *      the rules engine — the same digits, a different measurement.
 *
 * Both are the same bug: a score with no record of its input. An analysis now
 * carries a fingerprint of the body it read and the engine that read it, and
 * anything that does not match is STALE. A stale score is never trusted — it is
 * not displayed as current, its Apply actions are disabled, and it cannot
 * satisfy the approval gate. Recompute is asynchronous; only approval blocks.
 *
 * Bump ENGINE_REVISION whenever a change alters what a score MEANS (a new rule,
 * a changed weight, a different scale) — that invalidates every stored score,
 * which is the point. Do not bump it for a bug fix that leaves the scale alone.
 */

import { createHash } from "node:crypto";

import { readabilityRulesEngineEnabled } from "./feature-flags";

/**
 * Bump when the meaning of a score changes. See the note above.
 *
 * 2 — readability rules moved from presence-based to density-based failure
 *     (RULE_TOLERANCE_RATE), and READABILITY_FLOOR/TARGET were recalibrated to
 *     70/85. A stored "53" from revision 1 and a "53" from revision 2 are not
 *     the same claim, so every prior score is invalidated and must be re-run.
 */
const ENGINE_REVISION = 2;

export type AnalysisFingerprint = {
  /** sha256 of the exact body text that was scored. */
  body_sha256: string;
  /** Which scorer produced the numbers, e.g. "rules.v1" or "flesch.v1". */
  engine: string;
  scored_at: string;
};

/** Identifier for the scorer currently in effect. */
export function currentEngine(): string {
  const base = readabilityRulesEngineEnabled() ? "rules" : "flesch";
  return `${base}.v${ENGINE_REVISION}`;
}

export function fingerprintBody(body: string): string {
  return createHash("sha256").update(body ?? "", "utf8").digest("hex");
}

export function buildFingerprint(body: string): AnalysisFingerprint {
  return {
    body_sha256: fingerprintBody(body),
    engine: currentEngine(),
    scored_at: new Date().toISOString(),
  };
}

export type StalenessReason = "edited" | "engine" | "unfingerprinted" | "none";

export type Staleness = {
  stale: boolean;
  reason: StalenessReason;
  /** Sentence for the UI. Empty when not stale. */
  message: string;
};

const FRESH: Staleness = { stale: false, reason: "none", message: "" };

/**
 * Is this stored analysis still a valid measurement of this body?
 *
 * An analysis with no fingerprint predates this feature. We cannot tell what it
 * measured, so it is stale — "unknown" and "current" are not the same claim, and
 * treating them alike is what let a Flesch number sit under a rules-engine
 * label for nine days.
 */
export function analysisStaleness(
  scoredAgainst: AnalysisFingerprint | null | undefined,
  body: string,
): Staleness {
  if (!scoredAgainst?.body_sha256) {
    return {
      stale: true,
      reason: "unfingerprinted",
      message:
        "This score was recorded before scores tracked their input, so it cannot be matched to the current draft. Re-run the analysis.",
    };
  }
  if (scoredAgainst.engine !== currentEngine()) {
    return {
      stale: true,
      reason: "engine",
      message: `This score came from a different scoring engine (${scoredAgainst.engine}, now ${currentEngine()}) and does not mean the same thing. Re-run the analysis.`,
    };
  }
  if (scoredAgainst.body_sha256 !== fingerprintBody(body)) {
    return {
      stale: true,
      reason: "edited",
      message: "The draft has changed since this score was calculated. Re-run the analysis.",
    };
  }
  return FRESH;
}
