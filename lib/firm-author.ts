/**
 * Firm content author — the byline every generated or refreshed article uses.
 * Single source of truth so content is always attributed to a real attorney and
 * NEVER invents a name or carries forward a wrong byline from a live page (the
 * "Yevgeniy Melinger, Managing Partner" that a page refresh preserved verbatim).
 *
 * This is the lightweight precursor to the full E-E-A-T authorship feature
 * (master-spec Part 3), which adds a structured author field, an author/reviewedBy
 * schema block, and a bio box. Until then, edit the values here to change the
 * byline everywhere.
 */

export type FirmAuthor = {
  name: string;
  title: string;
  firm: string;
  /** e.g. "15+ years". */
  experience: string;
  /** One-line credential/experience summary for a byline or bio box. */
  bio: string;
};

export const FIRM_AUTHOR: FirmAuthor = {
  name: "Kenneth Katz",
  title: "Managing Partner",
  firm: "Katz Melinger PLLC",
  experience: "15+ years",
  bio:
    "Kenneth Katz is the Managing Partner of Katz Melinger PLLC with 15+ years of " +
    "experience representing employees and businesses in employment, wage-and-hour, " +
    "and collections matters.",
};

/** Prompt directive: attribute content to the firm author, replacing any other byline. */
export function renderAuthorDirective(author: FirmAuthor = FIRM_AUTHOR): string {
  return [
    "AUTHOR ATTRIBUTION (required):",
    `- This content's author is ${author.name}, ${author.title}, ${author.firm} (${author.experience} of experience).`,
    "- If the content includes an author line or byline, it MUST name this author exactly.",
    "- REPLACE any other author name or existing byline — including one already on the page — with this author. Never keep, invent, or attribute the content to a different name.",
  ].join("\n");
}
