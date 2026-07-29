/**
 * Firm attorney authors — the structured E-E-A-T author records (master-spec
 * Part 3). Single source of truth for bylines, bio boxes, and author/reviewedBy
 * schema, so YMYL legal content carries a credentialed, real attorney signal.
 *
 * Only credit an attorney who actually reviewed a piece. Keep each author's name,
 * bio_page_url, and same_as identical everywhere — consistency is what lets search
 * engines connect the profile.
 *
 * Code-seeded (edit here = one PR). Can move to an `authors` table + admin later
 * without changing callers, like current-facts.
 */

export type Author = {
  /** Stable slug / id. */
  id: string;
  name: string;
  title: string;
  firm: string;
  /** e.g. "15+ years". */
  experience: string;
  /** Degree(s) + honors, one line. */
  credentials: string;
  barAdmissions: string[];
  education: string[];
  practiceAreas: string[];
  /** One-line byline/bio-box summary. */
  bio: string;
  headshotUrl: string;
  /** The attorney's bio page on the firm site — the schema `url`. */
  bioPageUrl: string;
  /** Other profiles for schema `sameAs` (the attorney's own, not the firm's). */
  sameAs: string[];
};

export const KENNETH_KATZ: Author = {
  id: "kenneth-j-katz",
  name: "Kenneth J. Katz",
  title: "Managing Partner and Founding Member",
  firm: "Katz Melinger PLLC",
  experience: "15+ years",
  credentials: "J.D., Hofstra University School of Law (cum laude)",
  barAdmissions: [
    "New York",
    "New Jersey",
    "U.S. District Court, Eastern District of New York",
    "U.S. District Court, Northern District of New York",
    "U.S. District Court, Southern District of New York",
    "U.S. District Court, Western District of New York",
    "U.S. District Court, District of New Jersey",
    "U.S. Court of Appeals, Second Circuit",
  ],
  education: [
    "J.D., Hofstra University School of Law, cum laude",
    "B.S., Business Administration, State University of New York at Albany",
  ],
  practiceAreas: [
    "Employment Law",
    "Wage and Hour",
    "Commercial Judgments & Enforcement",
    "Discrimination",
    "FMLA",
    "Civil Litigation",
  ],
  // Verb-phrase fragment — the bio box supplies the name/title/firm/years intro,
  // so this must not repeat them.
  bio:
    "He represents employees and businesses in employment, wage-and-hour, and " +
    "collections matters.",
  headshotUrl: "https://katzmelinger.com/wp-content/uploads/2026/04/kenneth-katz.webp",
  bioPageUrl: "https://katzmelinger.com/attorney/kenneth-j-katz/",
  sameAs: [
    "https://www.linkedin.com/in/kenneth-katz11/",
    "https://lawyers.justia.com/lawyer/kenneth-joel-katz-1293483",
    "https://profiles.superlawyers.com/new-york/new-york/lawyer/kenneth-j-katz/eb42e2d2-937c-4d6e-8403-4f6ac12bc73a.html",
    "https://www.avvo.com/attorneys/10016-ny-kenneth-katz-997510.html",
    "https://lawyers.findlaw.com/new-york/new-york/kenneth-j-katz-NDg0NzM3NV8x/",
  ],
};

// Nicole Grunfeld and Adam Sackowitz have bio pages
// (katzmelinger.com/attorney/nicole-d-grunfeld/, …/adam-j-sackowitz/) and can be
// seeded here when per-practice-area authorship is wanted. For now bylines are
// uniformly Kenneth Katz (firm decision), so he is the only seeded author.
export const AUTHORS: Author[] = [KENNETH_KATZ];

export const DEFAULT_AUTHOR_ID = KENNETH_KATZ.id;

export function getAuthor(id?: string | null): Author {
  return AUTHORS.find((a) => a.id === id) ?? KENNETH_KATZ;
}

/** The author used when a piece has no explicit reviewer assigned. */
export function defaultAuthor(): Author {
  return getAuthor(DEFAULT_AUTHOR_ID);
}

/**
 * Deterministic "About the Author" bio box (Markdown) — accurate credentials and
 * the real bio-page link, built from the author record rather than left to the
 * model. Appended to content so YMYL pages carry a visible E-E-A-T signal.
 */
export function renderAuthorBioBox(author: Author = defaultAuthor()): string {
  const admitted = author.barAdmissions
    .filter((b) => !b.startsWith("U.S."))
    .join(" and ") || author.barAdmissions[0] || "";
  const admittedLine = admitted ? ` Admitted in ${admitted}.` : "";
  return [
    "## About the Author",
    "",
    `**${author.name}** is the ${author.title} of ${author.firm} with ${author.experience} of experience. ` +
      `${author.bio}${admittedLine} ${author.credentials}. ` +
      `[Read ${author.name.split(" ")[0]}'s full bio](${author.bioPageUrl})`,
  ].join("\n");
}

// Matches an existing bio box (always last) so re-running a refresh replaces it
// with current details instead of stacking duplicates.
const BIO_BOX_RE = /\n*##\s+About the Author[\s\S]*$/i;

/** Append (idempotently) the author bio box to a Markdown body. */
export function appendAuthorBioBox(body: string, author: Author = defaultAuthor()): string {
  const stripped = (body ?? "").replace(BIO_BOX_RE, "").trimEnd();
  return `${stripped}\n\n${renderAuthorBioBox(author)}\n`;
}
