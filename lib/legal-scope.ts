/**
 * What the legal-accuracy layer is allowed to have an opinion about.
 *
 * This is the scope rule from Diana's 21 September refinements (2.1), and it
 * is a definition rather than a heuristic: it decides which sentences the
 * layer looks at AT ALL, which is why it lives in its own module with its own
 * tests instead of inside the classifier.
 *
 * WHY THIS EXISTS
 *
 * The layer used to examine any sentence that "looked legal" — which, on a
 * blog about employment law, is nearly every sentence. A draft on whether
 * gender is a protected class produced ~96 legal findings, almost all of them
 * "Unclassified legal claim — routed for review" sitting on sentences that
 * were perfectly correct, including one on a heading. That buries the two or
 * three findings that matter and teaches reviewers to ignore the panel.
 *
 * THE RULE
 *
 * A sentence is in scope only if it carries something a lookup could settle:
 *
 *   - a statutory CITATION (29 U.S.C. 2611, NYLL 198-c, N.J.S.A. 10:5-12)
 *   - a legal FIGURE — a wage/salary threshold, a filing deadline, a coverage
 *     threshold, an effective date
 *
 * Everything else — plain-language explanation, a correct general statement, a
 * heading — is out of scope and produces nothing. "Gender is a protected class
 * under federal, New York state, and New York City law" is true, cites
 * nothing, and states no figure: the layer has no business filing anything
 * against it.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 *
 * Merely naming a statute ("Title VII protects employees from discrimination")
 * does not put a sentence in scope. Whether a named act EXISTS is already
 * checked separately over the whole body by lib/legal-named-acts.ts, which
 * needs no per-sentence claim; and whether a bare mention is being used
 * correctly is an interpretation question, not a lookup. Treating every
 * acronym as a claim is most of how the old behaviour got to 96 findings.
 *
 * Claims about the FIRM are not here either, though the old filter admitted
 * them. Fee language and invented firm statistics are already checked by
 * lib/content-compliance.ts, which runs the very same two functions
 * (findFeeLanguage, findFirmFactClaims) and files them under `compliance`
 * where they belong — they are advertising-rule problems, not legal-accuracy
 * ones. Keeping them here too filed each hit twice under two different
 * sources, the same duplication the known-traps gate had.
 */

import { findCitations } from "./legal-citation";

export type LegalScopeKind = "citation" | "figure";

/**
 * A number that is a legal constant rather than incidental prose.
 *
 * Covers the three shapes Diana's rule names — money (salary thresholds,
 * minimum wage), periods (filing deadlines, statutes of limitation), and
 * coverage thresholds ("four or more employees") — plus effective dates, since
 * a figure is only right or wrong relative to when it took effect.
 *
 * Spanish is tested alongside English rather than as a separate mode, matching
 * how the rest of this layer handles the companions (spec 5.2).
 */
const LEGAL_FIGURE = new RegExp(
  [
    // Money: $17, $1,199.10, $684 per week
    String.raw`\$\s?[\d,]+(?:\.\d{2})?`,
    // Periods: 300 days, 3 years, 1,250 hours — and SPELLED OUT, because
    // "the deadline is one year" is Diana's single most common recurring
    // error and a digits-only pattern reads straight past it.
    String.raw`\b(?:[\d,]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|eighteen|twenty|thirty|forty|fifty|sixty|ninety)\s*(?:calendar\s+|business\s+|work(?:ing)?\s+)?(?:days?|weeks?|months?|years?|hours?)\b`,
    String.raw`\b(?:[\d,]{1,7}|un|una|dos|tres|cuatro|cinco|seis|diez|doce|quince|veinte|treinta|sesenta|noventa)\s*(?:d[ií]as?|semanas?|meses?|a[nñ]os?|horas?)\b`,
    // Coverage thresholds: four or more employees, at least 15 employees,
    // 20+ employees, fewer than four employees
    String.raw`\b(?:\d{1,4}|one|two|three|four|five|ten|fifteen|twenty|fifty)\s*\+?\s*(?:or\s+more\s+|or\s+fewer\s+)?employees\b`,
    String.raw`\b(?:at\s+least|fewer\s+than|more\s+than|minimum\s+of|no\s+fewer\s+than)\s+(?:\d{1,4}|one|two|three|four|five|ten|fifteen|twenty|fifty)\b`,
    String.raw`\b(?:\d{1,4}|cuatro|cinco|quince|veinte|cincuenta)\s*(?:o\s+m[áa]s\s+)?emplead[oa]s\b`,
    // Rates: time and a half, 1.5 times
    String.raw`\btime\s+and\s+(?:a\s+)?half\b`,
    String.raw`\b1\.5\s*(?:times|x)\b`,
    // Percentages. No trailing \b: the boundary after "%" can only match when
    // a word character follows, so "70% of our clients" never matched at all.
    String.raw`\b\d{1,3}(?:\.\d+)?\s*(?:%|percent\b|por\s+ciento\b)`,
    // Effective / amendment dates
    String.raw`\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b`,
    String.raw`\b(?:effective|amended|enacted|as\s+of)\s+(?:on\s+)?\w+\s+\d`,
    String.raw`\b(?:vigente|enmendad[oa]|promulgad[oa])\s+(?:desde|el)\s+\w+\s+\d`,
    String.raw`\b\d{4}\s+amendments?\b`,
  ].join("|"),
  "i",
);

/**
 * Which in-scope things this sentence carries. Empty means out of scope, and
 * out of scope means the layer says nothing about it.
 */
export function legalScopeKinds(sentence: string): LegalScopeKind[] {
  if (!sentence?.trim()) return [];
  const kinds: LegalScopeKind[] = [];
  if (findCitations(sentence).length > 0) kinds.push("citation");
  if (LEGAL_FIGURE.test(sentence)) kinds.push("figure");
  return kinds;
}

/** Does the legal layer get to look at this sentence at all? */
export function inLegalScope(sentence: string): boolean {
  return legalScopeKinds(sentence).length > 0;
}

/**
 * Is this claim ANCHORED to something checkable — a citation or a figure?
 *
 * Used at finding time rather than extraction time. A sentence can be in scope
 * because it states a figure and still end up classified as interpretation;
 * that one is worth an attorney's eye because there is a concrete assertion
 * under the conclusion. A sentence with neither is the generic prose the scope
 * rule exists to ignore.
 */
export function isAnchored(sentence: string): boolean {
  return legalScopeKinds(sentence).length > 0;
}
