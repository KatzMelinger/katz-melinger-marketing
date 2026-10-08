/**
 * Findings always match the current text (Diana's Oct 6 spec, Task 21).
 *
 * A finding quotes the sentence it was raised on. When that sentence is no
 * longer in the draft, the finding describes a text nobody can see any more:
 * on 2026-10-06, 43fb024e was blocked by "NYSHRL applies to employers with
 * four or more employees" after the body had been corrected to "all
 * employers", and 261 open findings across the library quoted text that was
 * gone. The carry-forward rules in analyzeDraft (a check that did not run
 * keeps its earlier findings) are what let those survive a re-run.
 *
 * So before a finding is shown or used to block, its quote is looked up in the
 * current body. Missing means closed, with the reason "text no longer in
 * draft". Only findings whose excerpt IS a quote are judged: the AI
 * compliance check writes descriptions ("Entire page lacks the label"), and
 * the required-elements and missing-byline checks use their own label as the
 * excerpt — none of those can be looked up, so they are left alone.
 *
 * Pure: no IO.
 */

/** Comparable text: links to anchor text, markup and quotes normalized, lowercase. */
export function quoteText(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\]\([^)\s]*\)?|\(https?:[^)\s]*\)?/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[[\]*_`#>]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Engines and rules whose excerpt is a verbatim quote of the body. */
export function isQuoteFinding(f: { source: string; ruleId: string | null }): boolean {
  const rule = f.ruleId ?? "";
  if (rule.startsWith("required:")) return false;
  if (f.source === "legal" || f.source === "freshness") return true;
  // Deterministic compliance rules quote; the AI compliance check paraphrases.
  if (f.source === "compliance") return /^firm_/.test(rule);
  return false;
}

/**
 * Is the finding's quote still in the body? `null` when it cannot be judged
 * (not a quote, no excerpt, or nothing long enough to look up).
 *
 * Excerpts trimmed with "…" are split on it and every piece must be present;
 * pieces shorter than 12 characters say too little to judge.
 */
export function quoteStillPresent(
  f: { source: string; ruleId: string | null; excerpt: string | null },
  body: string,
): boolean | null {
  if (!isQuoteFinding(f) || !f.excerpt) return null;
  const parts = f.excerpt
    .split("…")
    .map(quoteText)
    .filter((p) => p.length >= 12);
  if (parts.length === 0) return null;
  const hay = quoteText(body);
  return parts.every((p) => hay.includes(p));
}

export const STALE_NOTE = "Closed automatically: text no longer in draft.";
