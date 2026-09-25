/**
 * One concern, one engine (Diana item 19).
 *
 * CASH, AEO and Readability aim at overlapping goals and run independently, so
 * the same note arrives three times under three names: headings-as-questions
 * from Readability AND AEO, cite-your-sources from AEO, CASH and SEO,
 * be-specific from Readability and CASH. A reviewer reads the panel as three
 * separate problems, fixes one, and the other two stay open describing the
 * thing they just fixed.
 *
 * The blocking half of item 19 shipped with item 12: none of the three can be a
 * blocker any more, which is enforced structurally in lib/finding-severity.ts.
 * This is the other half — the duplication.
 *
 * SUPPRESSION, NOT DELETION
 *
 * Diana's wording is "have the others reference that finding id instead of
 * raising their own". A suppressed finding does not vanish silently: the owning
 * finding's detail records which other engines also raised it, so the reviewer
 * can see that three checks agree rather than wondering why AEO went quiet.
 * Agreement between engines is information; three rows saying it is noise.
 *
 * ORDERING IS A SEPARATE GUARANTEE
 *
 * Diana also asks that correctness run before style, "so an Apply never
 * rewrites a span that is about to change for a legal reason". That is not
 * enforced here — it is enforced by WHERE this runs: the approval gate produces
 * legal and freshness findings before any analysis pass reaches this, and the
 * suppression below reads those existing findings rather than racing them.
 *
 * Pure module: no IO, so the ownership rules are testable and the panel can
 * import them.
 */

import type { FindingSource, NormalizedFinding, StoredFinding } from "./content-findings";

/**
 * A concern two or more engines both report, and the one that owns it.
 *
 * Owners are chosen by which engine can say the most useful thing about it, not
 * by which is loudest:
 *
 *   headings-as-questions  -> AEO. It is an answer-engine tactic; Readability
 *                             only knows the sentence ends in a question mark.
 *   authority-and-citation -> LEGAL. Only the legal layer knows whether the
 *                             citation is RIGHT. AEO and CASH can tell it is
 *                             present, which is the credit that let a wrong
 *                             citation score well.
 *   vague-vs-specific      -> CASH. Answer completeness is its actual subject.
 *   author-credentials     -> CASH. The H in CASH is exactly this.
 */
export type Concern = {
  id: string;
  owner: FindingSource;
  /** Engines whose version of this concern is suppressed in the owner's favour. */
  deferring: readonly FindingSource[];
  test: RegExp;
};

export const CONCERNS: readonly Concern[] = [
  {
    id: "headings-as-questions",
    owner: "aeo",
    deferring: ["readability", "seo"],
    test: /heading[s]?\s+(as|into|to)\s+question|question[- ]form(at)?\s+heading|phrase.{0,20}heading.{0,20}question|h2.{0,20}question/i,
  },
  {
    id: "authority-and-citation",
    owner: "legal",
    deferring: ["cash", "aeo", "seo"],
    test: /\b(cite|citation|cited|sourc(e|es|ing)|authorit(y|ies)|statut(e|es)|link to (the )?(statute|source|authority))\b/i,
  },
  {
    id: "vague-vs-specific",
    owner: "cash",
    deferring: ["readability", "aeo"],
    test: /\b(be more specific|too vague|vague|unspecific|add specifics|generic (claim|statement)|concrete (example|detail))\b/i,
  },
  {
    id: "author-credentials",
    owner: "cash",
    deferring: ["aeo", "seo"],
    test: /\b(author|byline|credential|attribution|bio)\b/i,
  },
];

export type CoordinationResult = {
  findings: NormalizedFinding[];
  /** What was dropped and why — logged, and surfaced on the owning finding. */
  suppressed: { finding: NormalizedFinding; concern: string; owner: FindingSource }[];
};

/** Does this finding read like this concern? */
function matches(f: NormalizedFinding, concern: Concern): boolean {
  return concern.test.test(`${f.title} ${f.detail ?? ""} ${f.fix ?? ""}`);
}

/**
 * An AEO "make this a list" note is only useful when the block actually IS a
 * list. AEO suggests it on prose the brand deliberately wants as prose, which
 * is Diana's "AEO pushes lists where the brand wants prose".
 *
 * A block counts as a genuine list when the excerpt carries the shape of one:
 * several comma- or semicolon-separated clauses, or an explicit enumeration.
 */
export function isGenuineList(excerpt: string | null | undefined): boolean {
  const t = (excerpt ?? "").trim();
  if (!t) return false;
  if (/(^|\n)\s*(?:[-*•]|\d+[.)])\s+/.test(t)) return true;
  if (/\b(first|second|third|finally)\b.*\b(first|second|third|finally)\b/i.test(t)) return true;
  const separators = (t.match(/[;,]/g) ?? []).length;
  return separators >= 3;
}

const LIST_SUGGESTION = /\b(bullet|numbered list|as a list|list format|break .{0,20}into a list)\b/i;

/**
 * Apply the ownership rules to one run's findings.
 *
 * `existing` is what is already tracked on the draft — the legal and freshness
 * findings the approval gate wrote. It matters for the CASH rule: a citation
 * concern defers to the legal layer whether or not the legal layer raised
 * something in THIS run, because legal findings arrive on a different pass.
 */
export function coordinateFindings(
  incoming: readonly NormalizedFinding[],
  opts: {
    existing?: readonly StoredFinding[];
    /** Phrases the brand voice config explicitly allows (item 19's Readability rule). */
    brandAllows?: readonly string[];
  } = {},
): CoordinationResult {
  const kept: NormalizedFinding[] = [];
  const suppressed: CoordinationResult["suppressed"] = [];

  // Which engines actually have something to say about each concern this run,
  // counting the findings already tracked on the draft.
  const pool = [...incoming, ...(opts.existing ?? [])];
  const ownerHasIt = new Map<string, boolean>();
  for (const concern of CONCERNS) {
    ownerHasIt.set(
      concern.id,
      pool.some((f) => f.source === concern.owner && matches(f, concern)),
    );
  }

  // Spans carrying an open legal or freshness finding. Readability's
  // "be specific" is suppressed on these: the sentence is about to change for a
  // correctness reason, and polishing it first wastes the edit.
  const contestedSpans = (opts.existing ?? [])
    .filter(
      (f) =>
        (f.source === "legal" || f.source === "freshness") &&
        (f.status === "open" || f.status === "in_progress") &&
        !!f.excerpt,
    )
    .map((f) => (f.excerpt ?? "").toLowerCase().slice(0, 80))
    .filter(Boolean);

  const brandAllows = (opts.brandAllows ?? []).map((p) => p.toLowerCase()).filter(Boolean);

  for (const f of incoming) {
    // 1. Concern ownership.
    const concern = CONCERNS.find((c) => c.deferring.includes(f.source) && matches(f, c));
    if (concern && ownerHasIt.get(concern.id)) {
      suppressed.push({ finding: f, concern: concern.id, owner: concern.owner });
      continue;
    }

    // 2. AEO's list suggestion, only where there is a list.
    if (f.source === "aeo" && LIST_SUGGESTION.test(`${f.title} ${f.fix ?? ""}`) && !isGenuineList(f.excerpt)) {
      suppressed.push({ finding: f, concern: "list-on-prose", owner: "brand_voice" });
      continue;
    }

    // 3. Readability defers to an open correctness finding on the same span.
    if (f.source === "readability" && f.excerpt) {
      const span = f.excerpt.toLowerCase().slice(0, 80);
      const contested = contestedSpans.some((s) => s.includes(span) || span.includes(s));
      if (contested && /\b(specific|vague|concrete)\b/i.test(`${f.title} ${f.fix ?? ""}`)) {
        suppressed.push({ finding: f, concern: "span-pending-correction", owner: "legal" });
        continue;
      }
    }

    // 4. Readability defers to the brand voice config.
    if (f.source === "readability" && brandAllows.length) {
      const text = `${f.title} ${f.excerpt ?? ""}`.toLowerCase();
      if (brandAllows.some((p) => text.includes(p))) {
        suppressed.push({ finding: f, concern: "brand-voice-allows", owner: "brand_voice" });
        continue;
      }
    }

    kept.push(f);
  }

  // Record the agreement on the owning finding, so a reviewer sees that three
  // checks concur rather than wondering where the other two went.
  const bySuppressedConcern = new Map<string, FindingSource[]>();
  for (const s of suppressed) {
    const list = bySuppressedConcern.get(s.concern) ?? [];
    if (!list.includes(s.finding.source)) list.push(s.finding.source);
    bySuppressedConcern.set(s.concern, list);
  }

  const annotated = kept.map((f) => {
    const concern = CONCERNS.find((c) => c.owner === f.source && matches(f, c));
    const also = concern ? bySuppressedConcern.get(concern.id) : undefined;
    if (!also?.length) return f;
    return {
      ...f,
      detail: `${f.detail ?? ""}${f.detail ? " " : ""}Also raised by: ${also.join(", ")}.`.trim(),
    };
  });

  return { findings: annotated, suppressed };
}

/**
 * Cap CASH's Source Expertise when the legal layer has an open citation
 * finding (Diana item 11 and item 19).
 *
 * CASH scores "are claims grounded — case names, statutes, agency citations"
 * by asking a model to look at the draft. A model looking at a draft can see
 * that a citation is THERE; it cannot see that Article 6 is the wrong article
 * for the overtime rule. So on the Unpaid Wages blog it credited the citation
 * that the legal layer flagged as wrong, and the scorecard read better because
 * of an error.
 *
 * The cap is applied rather than the score zeroed: sourcing is more than one
 * citation, and a draft with ten good sources and one bad one has not become
 * unsourced. What it must not do is read as well-sourced while a source it
 * relies on is disputed.
 */
export const UNVALIDATED_SOURCE_CAP = 50;

export function capSourceExpertise(
  sourceExpertise: number | null,
  existing: readonly StoredFinding[],
): { score: number | null; capped: boolean } {
  if (sourceExpertise === null) return { score: null, capped: false };
  const disputed = existing.some(
    (f) =>
      f.source === "legal" &&
      (f.status === "open" || f.status === "in_progress") &&
      /\b(cite|citation|authority|statute|section)\b/i.test(`${f.title} ${f.detail ?? ""}`),
  );
  if (!disputed || sourceExpertise <= UNVALIDATED_SOURCE_CAP) {
    return { score: sourceExpertise, capped: false };
  }
  return { score: UNVALIDATED_SOURCE_CAP, capped: true };
}
