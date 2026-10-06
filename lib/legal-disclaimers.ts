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

/**
 * Per-post disclaimers — spec 1.4, Diana's decision of 2026-09-18. Distinct
 * from FOOTER_DISCLAIMER above (Kenneth's Aug 31 SITE-WIDE footer wording,
 * inserted by the WordPress theme on every page regardless of content): these
 * are inserted INTO the body of each generated blog/service-page draft by the
 * content pipeline itself (2.12) — a newly generated page carries them before
 * anyone reviews it, the same "fixed text, auto-inserted" pattern as the
 * locked offer phrase and social phone numbers (1.1).
 *
 * Wording is exactly what the spec quotes; it is not this module's to edit.
 */
export const ATTORNEY_ADVERTISING_LABEL = "Attorney Advertising";

/**
 * The closing disclaimer on every blog and web page. Kenneth's wording as
 * counsel, 2026-09-29 — reproduce verbatim, never edit. "Disclaimer" links to
 * the firm's full disclaimer page. (He wrote "attorney client" unhyphenated;
 * that is deliberate house style — no dashes.)
 */
export const DISCLAIMER_URL = "https://katzmelinger.com/disclaimer/";
export const GENERAL_LEGAL_DISCLAIMER_TEXT =
  "This article is for general informational purposes only, is not legal advice and does not create an attorney client relationship. For more information see our full Disclaimer.";
export const GENERAL_LEGAL_DISCLAIMER =
  "This article is for general informational purposes only, is not legal advice and does not create an attorney client relationship. For more information see our full " +
  `[Disclaimer](${DISCLAIMER_URL}).`;

/**
 * Closing disclaimers used before 2026-09-29. A draft carrying one of these is
 * rewritten to the current wording rather than getting a second disclaimer.
 */
const LEGACY_GENERAL_DISCLAIMERS = [
  "This article provides general information and is not legal advice. Consult with an attorney about your specific situation.",
];

export const RESULTS_DISCLAIMER =
  "Prior results do not guarantee a similar outcome. Results vary depending on your particular facts and legal circumstances.";

export function hasAttorneyAdvertisingLabel(body: string): boolean {
  return body.toLowerCase().includes("attorney advertising");
}

/** Markdown emphasis and link syntax removed, whitespace collapsed, lowercased. */
function plain(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True only for the CURRENT wording — a legacy disclaimer does not count. */
export function hasGeneralLegalDisclaimer(body: string): boolean {
  return plain(body).includes(plain(GENERAL_LEGAL_DISCLAIMER_TEXT));
}

/** Does the body link the word "Disclaimer" to the disclaimer page? */
export function hasDisclaimerLink(body: string): boolean {
  return body.includes(DISCLAIMER_URL) || /href=["']https?:\/\/(?:www\.)?katzmelinger\.com\/disclaimer\/?["']/i.test(body);
}

/**
 * The closing call to action. The offer phrase is Kenneth's (2026-09-29); the
 * phone number comes from the operating brief (brand_voice_settings) so the
 * number can change without a code change.
 */
export function closingCta(phone: string, offerPhrase: string): string {
  return `Call today at ${phone} for a ${offerPhrase}.`;
}

export function hasClosingCta(body: string, phone: string, offerPhrase: string): boolean {
  const t = plain(body);
  return t.includes(offerPhrase.toLowerCase()) && t.includes(phone.toLowerCase());
}

export function hasResultsDisclaimer(body: string): boolean {
  const t = body.toLowerCase();
  return t.includes("prior results do not guarantee") && t.includes("results vary depending on your particular facts");
}

/**
 * Deliberately narrow signal for "this content discusses a case result or
 * outcome" (1.4's trigger for the results disclaimer): a dollar figure
 * appearing near a result-shaped word. Prose ABOUT the concept of damages in
 * the abstract ("employees may recover unpaid wages") shouldn't trip this —
 * only a claim that reads like an actual result should, which is why this
 * requires the dollar sign, not just the vocabulary alone.
 */
const RESULT_SIGNAL =
  /\$\s?[\d,]+(?:\.\d{2})?(?:\s*(?:million|k|thousand))?\b[^.!?]{0,80}\b(settlement|verdict|judgment|award(?:ed)?|recovered|secured|obtained|won)\b|\b(settlement|verdict|judgment|awarded|recovered|secured|obtained|won)\b[^.!?]{0,80}\$\s?[\d,]+(?:\.\d{2})?/i;

export function looksLikeCaseResult(body: string): boolean {
  return RESULT_SIGNAL.test(body);
}


/* ------------------------------------------------------------------------- */
/* The ending normalizer (Oct 6 spec, Task 2)                                */
/* ------------------------------------------------------------------------- */

/** "Call today at" anywhere in a line. */
const CTA_START = /\bcall\s+(?:us\s+)?today\s+at\b/i;
/** A short line that is an older CTA: "Call (212) 460-0047 for a ...". */
const OLD_CTA_LINE = /^call\b[^.]{0,40}\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}/;

/**
 * Is this (plain-text) line a closing disclaimer? The locked one, Diana's
 * reworded one, the site footer pasted into a body, or a short "not legal
 * advice" paragraph. Long prose that merely mentions legal advice is not.
 */
function isDisclaimerLine(p: string): boolean {
  if (!p) return false;
  if (p.includes("general informational purposes only")) return true;
  if (LEGACY_GENERAL_DISCLAIMERS.map(plain).includes(p)) return true;
  return (
    p.length < 400 &&
    /\b(?:is not|does not constitute|not intended as|should not be construed (?:to be|as)) (?:formal )?legal advice\b/.test(p) &&
    /\b(?:informational|general information|attorney client relationship)\b/.test(p)
  );
}

/** An emphasised label glued anywhere in a line ("...PLLC*Attorney Advertising*"). */
const LABEL_TOKEN = /\*{1,2}\s*Attorney Advertising\.?\s*\*{1,2}/gi;

export type EndingChange = {
  where: "Top" | "End" | "Body";
  from: string;
  to: string;
  reason: string;
  ref: "label" | "cta" | "general_disclaimer" | "results_disclaimer";
  /** Text just before the change in the NEW body, so Undo can put a deletion back. */
  anchor?: string;
};

/**
 * Remove the CTA from one line and keep any other sentence on it. Returns ""
 * when nothing else was on the line.
 */
function stripCtaFromLine(line: string): string {
  const p = plain(line);
  if (OLD_CTA_LINE.test(p) && p.length < 200) return "";
  const first = line.search(CTA_START);
  if (first === -1) return line;
  // The CTA can be nested inside itself ("Call today at X for a Call today
  // at Y for a ..."), so it runs from the first "Call today at" to the end of
  // the sentence after the LAST one.
  let last = first;
  for (const m of line.matchAll(new RegExp(CTA_START.source, "gi"))) last = m.index ?? last;
  const tail = line.slice(last);
  const stop = tail.match(/[.!?]+(?=\s|\*|_|$)/);
  const end = stop?.index === undefined ? line.length : last + stop.index + stop[0].length;
  const kept = (line.slice(0, first).trimEnd() + line.slice(end))
    .replace(/(\*\*|__)\s*\1/g, "")
    .trimEnd();
  return plain(kept) ? kept : "";
}

/**
 * Rebuild a blog or web page so it carries exactly one of each fixed element:
 *
 *   *Attorney Advertising*          the first line
 *   ...body...
 *   **Call today at ... .**         the closing CTA (when `cta` is passed)
 *   *<the locked disclaimer>*       Kenneth's 2026-09-29 wording, verbatim
 *   *<results disclaimer>*          only when the page discusses a result
 *
 * Idempotent: every CTA, disclaimer and label is removed wherever it sits and
 * the canonical ones are added back, so a second run changes nothing. It
 * replaced an insert-if-missing version that judged "missing" by whether the
 * offer phrase and phone appeared anywhere, so a CTA in other wording
 * survived and a second one was appended (8 drafts carried two CTAs and 6
 * two disclaimers on 2026-10-02).
 *
 * It never deletes body prose: a paragraph that ends with a CTA keeps its
 * other sentences, and only the CTA sentence goes. Spanish pages are left
 * alone (`language: "es"`): there is no approved Spanish CTA or disclaimer
 * yet, and an English one on a Spanish page is wrong.
 *
 * Returns the net changes, so callers that keep a "Changes made" log can
 * record them; a canonical line that was already present is not a change.
 */
export function normalizeEnding(
  body: string,
  opts: { cta?: { phone: string; offerPhrase: string }; language?: string | null } = {},
): { body: string; inserted: string[]; changes: EndingChange[] } {
  if (!body?.trim() || (opts.language ?? "").toLowerCase().startsWith("es")) {
    return { body, inserted: [], changes: [] };
  }
  const label = `*${ATTORNEY_ADVERTISING_LABEL}*`;
  const ctaLine = opts.cta ? `**${closingCta(opts.cta.phone, opts.cta.offerPhrase)}**` : null;
  const disclaimerLine = `*${GENERAL_LEGAL_DISCLAIMER}*`;
  const resultsLine = `*${RESULTS_DISCLAIMER}*`;
  const needsResults = looksLikeCaseResult(body) || hasResultsDisclaimer(body);

  const removed: Omit<EndingChange, "reason">[] = [];
  const kept: string[] = [];
  const anchorNow = () => {
    const k = kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
    return (k ? k : label).slice(-40) + "\n\n";
  };
  for (const raw of body.split("\n")) {
    let line = raw;
    const p = plain(line);
    if (p === "attorney advertising" || p === "attorney advertising.") {
      removed.push({ where: "Body", from: raw, to: "", ref: "label", anchor: anchorNow() });
      continue;
    }
    if (new RegExp(LABEL_TOKEN.source, "i").test(line)) {
      line = line.replace(LABEL_TOKEN, "").trimEnd();
      removed.push({ where: "Body", from: raw, to: line, ref: "label" });
      if (!plain(line)) continue;
    }
    if (isDisclaimerLine(plain(line))) {
      removed.push({ where: "End", from: raw, to: "", ref: "general_disclaimer", anchor: anchorNow() });
      continue;
    }
    if (plain(line) === plain(RESULTS_DISCLAIMER)) {
      removed.push({ where: "End", from: raw, to: "", ref: "results_disclaimer", anchor: anchorNow() });
      continue;
    }
    const noCta = stripCtaFromLine(line);
    if (noCta !== line) {
      removed.push({ where: "End", from: raw, to: noCta, ref: "cta", anchor: noCta ? undefined : anchorNow() });
      if (!noCta) continue;
      line = noCta;
    }
    kept.push(line);
  }

  const core = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const parts = [label, core];
  if (ctaLine) parts.push(ctaLine);
  parts.push(disclaimerLine);
  if (needsResults) parts.push(resultsLine);
  const next = parts.join("\n\n") + (body.endsWith("\n") ? "\n" : "");

  if (next === body) return { body, inserted: [], changes: [] };

  const lines = body.split("\n").map((l) => l.trim());
  const count = (line: string) => lines.filter((l) => l === line).length;
  const canonical = new Set([label, ctaLine, disclaimerLine, resultsLine].filter(Boolean) as string[]);
  const reasonFor: Record<EndingChange["ref"], string> = {
    cta: "Only one closing CTA, in the locked wording, at the end (Oct 6 spec, Task 2).",
    label: '"Attorney Advertising" appears once, as the first line.',
    general_disclaimer: "Only the locked closing disclaimer, once, at the end (Kenneth, 2026-09-29).",
    results_disclaimer: "The results disclaimer appears once, at the end.",
  };
  const changes: EndingChange[] = [];
  const seenCanonical = new Set<string>();
  for (const r of removed) {
    // The first copy of a canonical line is moved, not changed; a second copy
    // is a duplicate and is reported as removed.
    const t = r.from.trim();
    if (canonical.has(t) && !r.to && !seenCanonical.has(t)) {
      seenCanonical.add(t);
      continue;
    }
    changes.push({ ...r, reason: reasonFor[r.ref] });
  }
  const inserted: string[] = [];
  const add = (ref: EndingChange["ref"], line: string | null, where: EndingChange["where"], reason: string) => {
    if (!line || count(line) > 0) return;
    inserted.push(ref);
    changes.push({ where, from: "", to: line, reason, ref });
  };
  add("label", label, "Top", "Required on every blog and web page (Sept 28 spec, section 6).");
  add("cta", ctaLine, "End", "Required on every blog and web page (Sept 28 spec, section 6).");
  add("general_disclaimer", disclaimerLine, "End", "Required on every blog and web page (Kenneth, 2026-09-29).");
  if (needsResults) add("results_disclaimer", resultsLine, "End", "The page discusses a result.");
  return { body: next, inserted, changes };
}

/**
 * The generation and edit callers' entry point: the same normalizer without
 * the change list (a freshly generated body has nothing to review against).
 */
export function applyRequiredDisclaimers(
  body: string,
  opts: { cta?: { phone: string; offerPhrase: string }; language?: string | null } = {},
): { body: string; inserted: string[] } {
  const r = normalizeEnding(body, opts);
  return { body: r.body, inserted: r.inserted };
}

/** How many closing CTAs the body carries (the required-elements check wants one). */
export function countClosingCtas(body: string): number {
  let n = 0;
  for (const line of body.split("\n")) {
    const p = plain(line);
    if (OLD_CTA_LINE.test(p) && p.length < 200) n++;
    else n += (line.match(new RegExp(CTA_START.source, "gi")) ?? []).length;
  }
  return n;
}

/** How many closing-disclaimer lines the body carries. */
export function countDisclaimers(body: string): number {
  return body.split("\n").filter((l) => isDisclaimerLine(plain(l))).length;
}

/** The last paragraph, skipping the results line that may follow the disclaimer. */
export function closingParagraph(body: string): string {
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  while (paras.length && plain(paras[paras.length - 1]) === plain(RESULTS_DISCLAIMER)) paras.pop();
  return paras[paras.length - 1] ?? "";
}

/** The first non-empty line. */
export function firstLine(body: string): string {
  return body.split("\n").find((l) => l.trim())?.trim() ?? "";
}

/** Markdown and link syntax removed, whitespace collapsed, lowercased. */
export { plain as plainText };
