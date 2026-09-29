/**
 * Required elements a blog or web page must carry before it can be approved
 * (Diana's Sept 28 spec, sections 6, 7 and 10.2).
 *
 * Pure: no IO. The approve route runs it server-side; a missing element holds
 * the draft the same way a Critical finding does. Readability, SEO, CASH and
 * brand voice are deliberately NOT here — they never block (section 7).
 *
 * The fix for label/CTA/disclaimer is mechanical (applyRequiredDisclaimers), so
 * each missing item says so; placeholders and schema code are never filled in
 * automatically.
 */
import {
  hasAttorneyAdvertisingLabel,
  hasClosingCta,
  hasDisclaimerLink,
  hasGeneralLegalDisclaimer,
} from "./legal-disclaimers";

export type MissingElement = {
  code:
    | "title"
    | "h1"
    | "label"
    | "cta"
    | "disclaimer"
    | "disclaimer_link"
    | "internal_links"
    | "placeholder"
    | "schema_in_body";
  label: string;
  /** Inserted automatically by "Insert required elements" when true. */
  autoFixable: boolean;
  excerpt?: string;
};

export const MIN_INTERNAL_LINKS = 3;

const SITE_LINK_RE = /https?:\/\/(?:www\.)?katzmelinger\.com(\/[^\s)"'<>\]]*)?/gi;

/**
 * Short root-level slugs drafts invent that are NOT pages on the site
 * (Appendix E: "never use short internal slugs such as /wage-theft-overtime/
 * or /hostile-work-environment/"), mapped to the real page for each.
 */
export const BAD_SLUGS: Record<string, string> = {
  "/wage-theft-overtime/": "https://katzmelinger.com/practice-areas/employment-law/wage-hour-claims-employees/",
  "/unpaid-wages/": "https://katzmelinger.com/practice-areas/employment-law/wage-hour-claims-employees/",
  "/hostile-work-environment/": "https://katzmelinger.com/new-york-hostile-work-environment-lawyer/",
  "/workplace-discrimination/": "https://katzmelinger.com/practice-areas/employment-law/discrimination/",
  "/employment-discrimination/": "https://katzmelinger.com/practice-areas/employment-law/discrimination/",
  "/discrimination/": "https://katzmelinger.com/practice-areas/employment-law/discrimination/",
  "/retaliation/": "https://katzmelinger.com/practice-areas/employment-law/retaliation/",
  "/sexual-harassment/": "https://katzmelinger.com/practice-areas/employment-law/sexual-harassment/",
  "/wrongful-termination/": "https://katzmelinger.com/practice-areas/employment-law/wrongful-termination/",
  "/fmla-violations/": "https://katzmelinger.com/practice-areas/employment-law/fmla-violations/",
  "/leave-accommodations/": "https://katzmelinger.com/new-york-leave-and-accommodation-violations-lawyer/",
  "/nyc-employment-lawyer/": "https://katzmelinger.com/practice-areas/employment-law/",
  "/employment-law/": "https://katzmelinger.com/practice-areas/employment-law/",
  "/severance/": "https://katzmelinger.com/practice-areas/employment-law/wrongful-termination/when-shouldnt-you-sign-a-ny-severance-agreement/",
};

/**
 * Distinct katzmelinger.com pages linked from the body, excluding the
 * disclaimer. A made-up short slug (BAD_SLUGS) does not count: it is a link
 * to a page that does not exist.
 */
export function internalLinks(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(SITE_LINK_RE)) {
    const path = (m[1] ?? "/").replace(/[.,;:]+$/, "").replace(/\/?$/, "/").toLowerCase();
    if (path === "/disclaimer/" || path === "/" || BAD_SLUGS[path]) continue;
    seen.add(path);
  }
  return [...seen];
}

export function hasH1(body: string): boolean {
  return /^#\s+\S/m.test(body) || /<h1[\s>]/i.test(body);
}

const PLACEHOLDER_RE = /\[?PLACEHOLDER\b[^\]\n]*\]?|Replace before publishing|\[(?:INSERT|TODO|TBD)[^\]]*\]/i;
const SCHEMA_RE = /application\/ld\+json|"@context"\s*:/i;

export function checkRequiredElements(args: {
  body: string;
  title: string | null;
  cta: { phone: string; offerPhrase: string };
}): MissingElement[] {
  const { body, title, cta } = args;
  const missing: MissingElement[] = [];
  const t = (title ?? "").trim();

  if (!t || t.toLowerCase() === "json") {
    missing.push({ code: "title", label: "The draft has no title", autoFixable: false });
  }
  if (!hasH1(body)) missing.push({ code: "h1", label: "The body has no H1 heading", autoFixable: false });
  if (!hasAttorneyAdvertisingLabel(body)) {
    missing.push({ code: "label", label: '"Attorney Advertising" label is missing', autoFixable: true });
  }
  if (!hasClosingCta(body, cta.phone, cta.offerPhrase)) {
    missing.push({
      code: "cta",
      label: `Closing CTA is missing ("Call today at ${cta.phone} for a ${cta.offerPhrase}.")`,
      autoFixable: true,
    });
  }
  if (!hasGeneralLegalDisclaimer(body)) {
    missing.push({ code: "disclaimer", label: "The closing disclaimer is missing or reworded", autoFixable: true });
  } else if (!hasDisclaimerLink(body)) {
    missing.push({ code: "disclaimer_link", label: '"Disclaimer" is not linked to /disclaimer/', autoFixable: true });
  }
  const links = internalLinks(body);
  if (links.length < MIN_INTERNAL_LINKS) {
    missing.push({
      code: "internal_links",
      label: `${links.length} internal link${links.length === 1 ? "" : "s"} to katzmelinger.com; at least ${MIN_INTERNAL_LINKS} are required, including the pillar page`,
      autoFixable: false,
    });
  }
  const ph = body.match(PLACEHOLDER_RE);
  if (ph) {
    missing.push({
      code: "placeholder",
      label: "The body contains a placeholder that must be replaced by a person",
      autoFixable: false,
      excerpt: ph[0].slice(0, 80),
    });
  }
  const sc = body.match(SCHEMA_RE);
  if (sc) {
    missing.push({
      code: "schema_in_body",
      label: "Schema (JSON LD) code is pasted into the article body; move it to the page schema field",
      autoFixable: false,
      excerpt: sc[0],
    });
  }
  return missing;
}
