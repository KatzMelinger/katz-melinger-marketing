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
  /** WordPress user login, so AutoPilot can publish the post under this author. */
  wpLogin: string;
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
  wpLogin: "kjkatz",
};

export const NICOLE_GRUNFELD: Author = {
  id: "nicole-d-grunfeld",
  name: "Nicole D. Grunfeld",
  title: "Partner",
  firm: "Katz Melinger PLLC",
  experience: "15+ years",
  credentials: "J.D., New York University School of Law (Vanderbilt Medal)",
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
    "J.D., New York University School of Law (Vanderbilt Medal for Outstanding Contributions)",
    "B.A., English Language and Literature, Yale University",
  ],
  practiceAreas: [
    "Employment and Labor Law",
    "Employment Discrimination",
    "Retaliation",
    "Wage and Hour",
    "FMLA",
    "Civil Litigation",
  ],
  // Worker-side framing: the firm represents employees.
  bio:
    "Since 2007 she has represented employees across the New York City metro area in " +
    "employment discrimination, retaliation, and wage-and-hour matters, appearing " +
    "regularly in state and federal court, arbitrations, mediations, and agency proceedings.",
  headshotUrl: "https://katzmelinger.com/wp-content/uploads/2026/04/nicole-grunfield.webp",
  bioPageUrl: "https://katzmelinger.com/attorney/nicole-d-grunfeld/",
  // External profiles only — the firm bio page is bioPageUrl. A sameAs pointing
  // back at our own domain corroborates nothing. No Justia profile for her.
  sameAs: [
    "https://www.linkedin.com/in/nicole-grunfeld-a2758a3/",
    "https://profiles.superlawyers.com/new-york/new-york/lawyer/nicole-d-grunfeld/b8d41193-2c7b-41f2-ac37-be55e711d7e6.html",
    "https://www.avvo.com/attorneys/10016-ny-nicole-grunfeld-4793013.html",
    "https://lawyers.findlaw.com/new-york/new-york/nicole-d-grunfeld-NDA3NjA0NF8x/",
  ],
  // TODO: set once the WordPress Author account exists.
  wpLogin: "",
};

export const ADAM_SACKOWITZ: Author = {
  id: "adam-j-sackowitz",
  name: "Adam J. Sackowitz",
  title: "Partner",
  firm: "Katz Melinger PLLC",
  experience: "10+ years",
  credentials: "J.D., UCLA School of Law",
  barAdmissions: [
    "New York",
    "New Jersey",
    "California (inactive)",
    "U.S. District Court, Southern District of New York",
    "U.S. District Court, Eastern District of New York",
    "U.S. District Court, Northern District of New York",
    "U.S. District Court, District of New Jersey",
    "U.S. Court of Appeals, Second Circuit",
  ],
  education: [
    "J.D., UCLA School of Law",
    "B.S., Industrial and Labor Relations, Cornell University",
  ],
  practiceAreas: [
    "Commercial Judgments & Enforcement",
    "Civil Litigation",
    "Employment Law",
    "Wage and Hour",
    "FMLA",
  ],
  // Verb-phrase fragment — the box supplies the name/title/firm intro.
  bio:
    "He represents clients in commercial collections and judgment enforcement, as " +
    "well as employment matters including discrimination, FMLA, and wage-and-hour claims.",
  headshotUrl: "https://katzmelinger.com/wp-content/uploads/2026/04/adam-sackowitz.webp",
  bioPageUrl: "https://katzmelinger.com/attorney/adam-j-sackowitz/",
  // External profiles only — see the note on Nicole's. No Justia profile for him.
  sameAs: [
    "https://www.linkedin.com/in/adam-sackowitz-08b88a83/",
    "https://profiles.superlawyers.com/new-york/new-york/lawyer/adam-j-sackowitz/51da3550-1383-4fbf-810a-532b558f174c.html",
    "https://www.avvo.com/attorneys/10016-ny-adam-sackowitz-4781911.html",
    "https://lawyers.findlaw.com/new-york/new-york/adam-j-sackowitz-NDk1ODQyMl8x/",
  ],
  // TODO: set once the WordPress Author account exists.
  wpLogin: "",
};

export const AUTHORS: Author[] = [KENNETH_KATZ, NICOLE_GRUNFELD, ADAM_SACKOWITZ];

export const DEFAULT_AUTHOR_ID = KENNETH_KATZ.id;

export function getAuthor(id?: string | null): Author {
  return AUTHORS.find((a) => a.id === id) ?? KENNETH_KATZ;
}

/** The author used when a piece has no explicit reviewer assigned. */
export function defaultAuthor(): Author {
  return getAuthor(DEFAULT_AUTHOR_ID);
}

/**
 * Resolve the author for a piece by expertise (firm decision):
 *   employment            → Nicole Grunfeld
 *   judgment enforcement  → Kenneth Katz   (its pillars roll up to "collections",
 *                                            so match the pillar, not practice_area)
 *   collections (other)   → Adam Sackowitz
 *   unmapped              → Kenneth Katz (fallback)
 * Pillar match is fuzzy so DB pillar ids/labels ("judgment-enforcement",
 * "domestication", …) all resolve regardless of exact slug.
 */
export function authorForContent(input: {
  practiceArea?: string | null;
  pillarId?: string | null;
}): Author {
  const pillar = (input.pillarId ?? "").toLowerCase();
  if (/judgment|enforcement|domestica/.test(pillar)) return getAuthor("kenneth-j-katz");
  const pa = (input.practiceArea ?? "").toLowerCase();
  if (pa === "employment") return getAuthor("nicole-d-grunfeld");
  if (pa === "collections") return getAuthor("adam-j-sackowitz");
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
  // "the Managing Partner" but "a Partner".
  const article = /managing|founding|chief|principal/i.test(author.title) ? "the" : "a";
  return [
    "## About the Author",
    "",
    `**${author.name}** is ${article} ${author.title} at ${author.firm} with ${author.experience} of experience. ` +
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
