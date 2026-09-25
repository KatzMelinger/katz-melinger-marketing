/**
 * Primary-keyword placement, as a generation constraint (Diana item 3b).
 *
 * "Place the primary keyword at generation in the spots the checker measures
 * (H1, first 100 words, one or two subheadings, meta), so 'Keyword placement'
 * scores well from the start. Diana should never have to raise SEO by hand."
 *
 * The four placements below are not a best-practice list — they are exactly
 * what the keywordPlacement scorer in lib/content-analysis.ts counts, one
 * source of truth in both directions. A generator told to do something the
 * scorer does not measure would produce drafts that read as keyword-stuffed
 * and still score badly; a scorer measuring something the generator was never
 * told about is the state this fixes, and is the same shape as readability
 * being scored against fifteen rules the generator had never been given.
 *
 * Deliberately NOT a density instruction. The scorer's fourth point asks only
 * that the keyword appear at least twice in the body, which natural writing on
 * the topic does by itself; asking for more invites the stuffing the brand
 * voice and the CASH "reads as AI-written" score both punish.
 */

export function keywordPlacementBlock(
  primaryKeyword: string,
  secondaryKeywords: string[] = [],
): string {
  const kw = (primaryKeyword ?? "").trim();
  if (!kw) return "";
  const secondary = secondaryKeywords
    .map((k) => (k ?? "").trim())
    .filter((k) => k && k.toLowerCase() !== kw.toLowerCase())
    .slice(0, 4);

  return [
    `PRIMARY KEYWORD PLACEMENT (the scorer checks these four exactly):`,
    `The primary keyword is "${kw}". Use it verbatim, not a paraphrase, in each of:`,
    `- the title`,
    `- the H1 (the single "# " heading)`,
    `- the first paragraph, within the first 100 words`,
    `- at least twice in the body overall, including one H2 subheading where it reads naturally`,
    secondary.length
      ? `Work these secondary keywords in where they fit, without forcing them: ${secondary.join(", ")}.`
      : "",
    `Write for the reader first. If the keyword cannot go somewhere without the sentence reading like SEO filler, leave it out of that one spot rather than bending the sentence around it.`,
  ]
    .filter(Boolean)
    .join("\n");
}
