/**
 * The firm's required advertising disclaimers — one source, approved by Kenneth
 * Katz on 2026-08-31.
 *
 * These exist as a module rather than as WordPress copy because three things
 * need the same words and will otherwise drift: the live site, the compliance
 * checker that verifies the live site carries them, and any generator that
 * produces a page describing a case result.
 *
 * WHY THIS WAS NEEDED
 *
 * A sweep of all 447 live pages on 2026-08-31 found the required disclaimers on
 * NONE of them. Fourteen case-result pages describe specific sums — $134,000 in
 * interest, a $2.5M judgment, a twelvefold severance increase, $215K in unpaid
 * overtime — with no prior-results language anywhere, and the words "Attorney
 * Advertising" appeared nowhere on the site, including the home page where the
 * rule permits a single label to cover it.
 *
 * lib/compliance-core.ts had encoded the RULES since the beginning. What was
 * missing was the TEXT, so nothing could check for it and nothing could insert
 * it. That is the same gap that let the metadata generator write "expert"
 * fifteen times while a prompt sat there forbidding it.
 *
 * THE WORDING IS NOT MINE TO EDIT
 *
 * Kenneth supplied these strings as counsel. They are reproduced verbatim.
 * Anything that looked like a research artifact rather than intended copy is
 * listed in DISCLAIMER_REVIEW_NOTES rather than silently changed.
 */

/**
 * Site-wide footer. Covers RPC 7.1(b)(2) labelling, the no-legal-advice and
 * no-attorney-client-relationship notice, prior results, and the New Jersey
 * approval statement, in one block on every page.
 *
 * Every page, not only the home page: the rule permits home-page-only, but the
 * site has 447 pages and deciding which of them count as advertising is a
 * judgment call nobody wants to make 447 times.
 */
export const FOOTER_DISCLAIMER = [
  "Attorney Advertising. This website is designed for general informational purposes only. " +
    "The information presented on this site should not be construed to be formal legal advice " +
    "nor the formation of an attorney-client relationship. Prior results do not guarantee a " +
    "similar outcome.",
  "No aspect of this advertisement has been approved by the Supreme Court of New Jersey. " +
    "Case results, testimonials, or Google reviews depend upon a variety of factors unique to " +
    "each matter and do not guarantee or predict a similar result in any future case.",
];

/**
 * Sits with the content it qualifies — under a case result, under a review
 * block. RPC 7.1(d) asks for PROMINENT, and a footer three screens below the
 * dollar figure is the placement that gets criticised.
 */
export const RESULTS_VARY =
  "Results vary depending on your particular facts and legal circumstances.";

/** Sits with any award, ranking, or badge. The link text is the second sentence. */
export const AWARDS_NOTICE =
  "No aspect of this advertisement has been approved by the NJ Supreme Court. " +
  "See Award Methodology Breakdown for selection details.";

/** Where AWARDS_NOTICE links. The methodology page still has to exist. */
export const AWARDS_METHODOLOGY_PATH = "/award-methodology/";

export const AWARDS_METHODOLOGY_INTRO = [
  "No aspect of this advertisement has been approved by the Supreme Court of New Jersey.",
  "Inclusion on any list, ranking, or accolade mentioned on this website does not imply that " +
    "the law firm or its attorneys possess superlative qualities or guarantee a specific " +
    "outcome for your legal matter. For detailed information regarding the selection " +
    "processes, standards, and methodologies utilized by these independent comparing " +
    "organizations, please visit their respective official methodology pages linked below:",
];

export type AwardMethodology = {
  name: string;
  /**
   * Rendered as the opening phrase. Null where naming a publisher would be
   * redundant or wrong - "Law Firm 500: Published by Law Firm 500" reads as
   * a generation artifact, because it is one.
   */
  publisher: string | null;
  basis: string;
  linkText: string;
  url: string;
  /** Whether an automated check could confirm the URL resolves. */
  verified: "yes" | "blocked" | "no";
  note?: string;
};

/**
 * One entry per award the site displays.
 *
 * `verified` records what an automated check could actually establish on
 * 2026-08-31, because "the link is fine" and "the link could not be checked"
 * are different states and collapsing them is how a dead citation ships on a
 * page whose entire purpose is to cite.
 */
export const AWARD_METHODOLOGIES: AwardMethodology[] = [
  {
    name: "Super Lawyers & Rising Stars",
    publisher: "Thomson Reuters",
    basis:
      "Selection is determined via a patented, multi-phase process incorporating peer " +
      "nominations, independent research, and blue-ribbon panel peer evaluations.",
    linkText: "Super Lawyers Selection Process Page",
    url: "https://www.superlawyers.com/about/selection_process.html",
    verified: "yes",
  },
  {
    name: "Best Lawyers in America",
    publisher: "Woodward/White Inc",
    basis:
      "Recognition is entirely data-driven, utilizing a sophisticated and transparent survey " +
      "process based purely on geographic and practice-area peer review.",
    linkText: "Best Lawyers Methodology Page",
    url: "https://www.bestlawyers.com/methodology",
    verified: "yes",
  },
  {
    name: "Law Firm 500",
    publisher: null,
    basis:
      "An annual award honoring the legal industry's fastest-growing law firms. Rankings are " +
      "strictly numbers-driven and calculated based on verified percentage revenue growth over " +
      "a consecutive three-year period.",
    linkText: "Law Firm 500 Official Page",
    url: "https://lawfirm500.com/",
    verified: "yes",
  },
  {
    name: "Lead Counsel Rated",
    publisher: "LawInfo",
    basis:
      "The rating evaluates individual practitioners based on strict criteria requiring a " +
      "verified, spotless bar disciplinary record, substantial professional experience, and " +
      "peer recommendations.",
    linkText: "Lead Counsel Rated",
    url: "https://www.lawinfo.com/lead-counsel/",
    verified: "yes",
    note:
      "Draft copy said 'Managed by FindLaw (a Thomson Reuters business)' and linked to the " +
      "findlaw.com home page. leadcounsel.org redirects to lawinfo.com/lead-counsel/, so the " +
      "publisher attribution needs confirming before this goes live.",
  },
  {
    name: "Inc. 5000",
    publisher: "Inc. Magazine",
    basis:
      "This honor ranks the fastest-growing private, independent, for-profit companies in the " +
      "United States. Rankings are calculated strictly according to an audited three-year " +
      "percentage revenue growth rate.",
    linkText: "Inc. 5000 Methodology Page",
    url: "https://www.inc.com/inc-5000-methodology-how-we-selected-these-companies.html",
    verified: "blocked",
    note: "inc.com returns 403 to automated requests. Open it in a browser before publishing.",
  },
];

/**
 * Things a human needs to decide, kept next to the copy rather than in a
 * message that scrolls away.
 */
export const DISCLAIMER_REVIEW_NOTES = [
  "The draft methodology copy carried bracketed footnote markers of the form [[1](url)]. " +
    "Two pointed off-site in ways that must not ship: one to lowenstein.com, a competing law " +
    "firm's award page, and one to albatross.cloud, an SEO vendor blog. The rest duplicated " +
    "the inline link. All were treated as research artifacts and are not reproduced here.",
  "'a audited three-year percentage revenue growth rate' is corrected to 'an audited'.",
  "Lead Counsel: publisher attribution and URL changed from FindLaw to LawInfo — confirm.",
  "Inc. 5000 link could not be verified automatically; confirm it in a browser.",
  "The awards notice links to " + AWARDS_METHODOLOGY_PATH + ", which does not exist yet.",
];

/**
 * Does this page carry the site-wide footer disclaimer?
 *
 * Matches on the distinctive spans rather than the whole block, so a line break,
 * a wrapping tag, or a trailing period does not produce a false negative. A
 * checker that reports a compliant page as missing is a checker people switch
 * off.
 */
export function hasFooterDisclaimer(pageText: string): boolean {
  const t = pageText.toLowerCase();
  return (
    t.includes("attorney advertising") &&
    t.includes("prior results do not guarantee") &&
    t.includes("supreme court of new jersey")
  );
}

/** Does this page carry the results-vary line next to results or reviews? */
export function hasResultsVary(pageText: string): boolean {
  return pageText.toLowerCase().includes("results vary depending on your particular facts");
}

/** Does this page carry the awards notice? */
export function hasAwardsNotice(pageText: string): boolean {
  const t = pageText.toLowerCase();
  return t.includes("approved by the nj supreme court") || t.includes("award methodology");
}
