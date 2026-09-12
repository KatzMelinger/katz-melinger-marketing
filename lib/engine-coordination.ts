/**
 * Cross-engine coordination (spec item 6).
 *
 * Readability, AEO, and CASH run independently and can each raise a finding
 * for the same underlying concern — an H2 that isn't structured as an
 * extractable answer, a citation nobody has actually verified. Rather than
 * showing that as two or three competing rows, one engine OWNS the concern
 * and the others defer to it with an "also raised by" note.
 *
 * What's achievable depends on what each engine's findings actually carry.
 * Readability's AI rules (11/13), Legal, and Freshness all anchor to a real
 * excerpt of the draft, so those three are matched and deferred span-by-span.
 * AEO and CASH are document-level checks with no per-instance excerpt (see
 * heuristicAEO / cashScore in lib/content-analysis.ts) — coordinating them is
 * necessarily coarser: AEO's document-wide "no FAQ-style block" finding
 * stands in for the per-heading 11/13 hits that describe the same gap, and
 * an open, unresolved legal-accuracy finding caps CASH's Source Expertise
 * pillar rather than gating any one specific citation.
 *
 * Deliberately excludes Compliance: it already has its own hard gate
 * (lib/agent/compliance-filter.ts), out of scope here — this module only
 * touches the three ADVISORY engines the report named (Readability, AEO,
 * CASH), and only ever downgrades/annotates findings, never upgrades one to a
 * blocker — severity is decided where each finding is normalized, not here.
 */

import type { ReadabilityFinding } from "./readability-rules";
import type { NormalizedFinding } from "./content-findings";

/** Local shape matching lib/content-analysis.ts's CashBreakdown — not
 *  imported from there to avoid a circular import (that module imports this
 *  one, not the other way around). */
type CashBreakdownLike = {
  conversationalAuthority: number;
  answerCompleteness: number;
  sourceExpertise: number;
  humanAttribution: number;
};

/** The exact AEO finding string marking the doc-wide "not structured for
 *  extractable Q&A" gap (see heuristicAEO in lib/content-analysis.ts).
 *  Readability's per-heading 11/13 hits are the same underlying problem at a
 *  finer grain, so when this fires, it stands in for them. */
const AEO_NO_FAQ_MARKER = "No FAQ-style block detected";

/** A Source-Expertise score above this cap implies confidently-cited
 *  authority — which an open critical legal finding directly contradicts.
 *  Matches the ScoreTile's own amber/emerald boundary (lib/analysis-card.tsx)
 *  so a capped score reads as "needs attention", not zeroed out unfairly. */
const UNVALIDATED_CITATION_CAP = 40;

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Loose overlap check: findings from different engines rarely quote
 *  byte-identical text (one may truncate or paraphrase punctuation), so this
 *  checks for meaningful substring containment rather than exact equality. */
function excerptsOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na.length < 8 || nb.length < 8) return false; // too short to mean anything
  return na === nb || na.includes(nb) || nb.includes(na);
}

function appendAlsoRaisedBy(detail: string | null, who: string): string {
  const note = `(also raised by ${who})`;
  if (!detail) return note;
  return detail.includes("also raised by") ? detail : `${detail} ${note}`;
}

export type CoordinationResult = {
  /** Readability findings with any that defer to Legal/Freshness/AEO removed. */
  readabilityFindings: ReadabilityFinding[];
  /** AEO findings, with an "also raised by" note appended to the owning
   *  finding when it stood in for suppressed Readability heading hits. */
  aeoFindings: string[];
  /** CASH breakdown, Source Expertise capped when a citation is unvalidated. */
  cashBreakdown: CashBreakdownLike;
  /** CASH findings, with an explanatory note appended when the cap applied. */
  cashFindings: string[];
  /** Count of findings suppressed as duplicates — for telemetry only. */
  suppressed: number;
};

export function coordinateEngineFindings(args: {
  readabilityFindings: ReadabilityFinding[];
  /** Raw AEO finding strings (heuristicAEO's output, pre-normalization). */
  aeoFindings: string[];
  /** Open Legal/Freshness findings this run — mutated in place to append
   *  "also raised by" notes (they're this run's own fresh objects, not
   *  shared/persisted state, so annotating them here is safe). */
  legalFindings: NormalizedFinding[];
  freshnessFindings: NormalizedFinding[];
  cashBreakdown: CashBreakdownLike;
  cashFindings: string[];
}): CoordinationResult {
  let suppressed = 0;
  const correctnessFindings = [...args.legalFindings, ...args.freshnessFindings];

  // 1) Readability defers to an open Legal/Freshness finding on the same
  //    span — a wrong citation or an outdated figure outranks a style nit
  //    about the same sentence. "Run correctness before style."
  let readabilityFindings = args.readabilityFindings.filter((r) => {
    const owner = correctnessFindings.find((o) => excerptsOverlap(r.excerpt, o.excerpt));
    if (!owner) return true;
    owner.detail = appendAlsoRaisedBy(owner.detail, "Readability");
    suppressed++;
    return false;
  });

  // 2) AEO owns "heading isn't structured as an extractable Q&A". Readability
  //    Rules 11 ("H2's first sentence isn't a direct answer") and 13 ("H2
  //    isn't a question") are the same concern at individual-heading grain.
  //    AEO has no per-heading anchor to defer TO, so its document-wide
  //    finding stands in for every per-heading hit instead of the two
  //    showing up as separate, competing rows.
  const aeoOwnsHeadings = args.aeoFindings.some((f) => f.includes(AEO_NO_FAQ_MARKER));
  const beforeHeadingFilter = readabilityFindings.length;
  if (aeoOwnsHeadings) {
    readabilityFindings = readabilityFindings.filter(
      (r) => r.ruleId !== "11" && r.ruleId !== "13",
    );
  }
  const headingsDeferred = beforeHeadingFilter - readabilityFindings.length;
  suppressed += headingsDeferred;
  const aeoFindings =
    headingsDeferred > 0
      ? args.aeoFindings.map((f) =>
          f.includes(AEO_NO_FAQ_MARKER)
            ? `${f} (also raised by Readability — ${headingsDeferred} heading${headingsDeferred === 1 ? "" : "s"})`
            : f,
        )
      : args.aeoFindings;

  // 3) CASH does not credit a citation the legal layer hasn't validated. CASH
  //    has no per-citation data to gate individually, so an open CRITICAL
  //    legal finding (a claim contradicted by, or unverifiable against, its
  //    cited authority) caps the whole Source Expertise pillar rather than
  //    letting the score imply the draft's citations are solid.
  const unvalidatedCitations = args.legalFindings.filter((f) => f.severity === "critical").length;
  const cashBreakdown = { ...args.cashBreakdown };
  let cashFindings = args.cashFindings;
  if (unvalidatedCitations > 0 && cashBreakdown.sourceExpertise > UNVALIDATED_CITATION_CAP) {
    cashBreakdown.sourceExpertise = UNVALIDATED_CITATION_CAP;
    cashFindings = [
      ...cashFindings,
      `[S] Source Expertise capped — ${unvalidatedCitations} citation${unvalidatedCitations === 1 ? "" : "s"} not yet validated by the legal-accuracy layer.`,
    ];
  }

  return { readabilityFindings, aeoFindings, cashBreakdown, cashFindings, suppressed };
}
