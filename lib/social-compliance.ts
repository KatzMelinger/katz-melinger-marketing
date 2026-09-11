/**
 * Fast, deterministic brand + attorney-advertising checks. Pure and
 * client-safe (no server imports), so the composer can flag a variation live as
 * it's edited and block scheduling until it's cleared — the "brand or
 * compliance flag" the spec requires.
 *
 * This is the cheap, always-on floor. It encodes the same failure modes the
 * LLM compliance reviewer (lib/compliance-core.ts) enforces on publish, plus
 * the Katz Melinger brand rules (no dashes, no fear-based urgency, no fee
 * language, New York / New Jersey spelled out). It is intentionally strict on
 * high-confidence patterns and silent on judgment calls, so a block is almost
 * always a real problem.
 *
 * TWO ASSET TYPES, NOT ONE
 *
 * The module began social-only, which is why the entry point is still named
 * checkSocialCompliance. It now also runs on blog and page bodies, because the
 * wrong office number reached the Unpaid Wages blog four times while a rule
 * that would have caught it sat here running on captions only.
 *
 * Not every rule crosses over. The brand and RPC rules do — a guarantee is a
 * guarantee wherever it appears. The social-only rules do not, and one of them
 * would do real damage if it did: `state_abbrev` forbids "NYC", which is
 * correct for a caption and wrong for a blog, where "unpaid wages lawyer NYC"
 * is a target keyword. Each rule therefore declares its `scope`.
 */

import { normalizePhone } from "./lead-response";

export type FlagSeverity = "block" | "warn";

/**
 * Which body this is. `social` is a caption or slide; `document` is a blog
 * post, a practice page, or anything else long-form. They differ in which
 * rules apply and — the reason Diana asked for this — which phone number is
 * the correct one.
 */
export type AssetType = "social" | "document";

export type ComplianceFlag = {
  code: string;
  label: string;
  severity: FlagSeverity;
  /** The offending text, for display. */
  excerpt: string;
};

export type ComplianceContext = {
  /** Defaults to "social" so every existing caller keeps its behaviour. */
  assetType?: AssetType;
  /** The correct social phone number (e.g. from the operating brief). Any other phone-shaped match is flagged. */
  socialPhone?: string;
  /** The correct phone number for blogs, pages and documents. */
  documentPhone?: string;
  /** The channel this post is for — gates the Instagram-link-CTA check. */
  platform?: string;
  /** The social format (carousel, script, post…) — gates the hashtag-block rule. */
  format?: string;
  /** This post's chosen CTA type — gates the missing-offer check. */
  ctaType?: string;
  /** The operating brief's offer phrase, required when ctaType is "consultation". */
  offerPhrase?: string;
  /** Path or URL of the general-information disclaimer page (S3, item 4). */
  disclaimerUrl?: string;
};

type RuleScope = "all" | "social";

type Rule = {
  code: string;
  label: string;
  severity: FlagSeverity;
  scope: RuleScope;
  re: RegExp;
};

/** US phone number in any common written form: (212) 460-0047, 212-460-0047, 212.460.0047, 2124600047. */
const PHONE_RE = /(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]?\d{4}/g;

// Order matters only for display. Each `re` has a capture/target used as the
// excerpt. All case-insensitive unless the pattern is inherently cased.
const RULES: Rule[] = [
  {
    code: "dash",
    scope: "all",
    label: "Em or en dash — brand rule is no dashes",
    severity: "block",
    re: /[‒–—―]|\s--\s/,
  },
  {
    code: "guarantee",
    scope: "all",
    label: "Result guarantee — prohibited (RPC 7.1)",
    severity: "block",
    re: /\b(guarantee(d|s)?|we('| wi)ll win|no win,?\s*no fee|100%\s*(win|success|recovery))\b/i,
  },
  {
    code: "superlative",
    scope: "all",
    label: "Superlative or specialist claim — prohibited (RPC 7.1 / 7.4)",
    severity: "block",
    // `#1` is pulled out of the \b group (a leading \b can't match before '#').
    // "expert"/"specialist" are only flagged as a self-claim ("we are experts",
    // "specializing in …"), not in legitimate terms like "expert witness".
    re: /#\s?1\b|\bnumber one\b|\btop[-\s]rated\b|\bbest (lawyer|attorney|law firm|firm)\b|\bleading (law )?firm\b|\bpremier (law )?firm\b|\bwinningest\b|\bmost experienced (lawyer|attorney|firm)\b|\b(we are|we're|our)( the)? (experts?|specialists?)\b|\bspecializ(e|es|ing) in\b/i,
  },
  {
    code: "fear",
    scope: "all",
    label: "Fear-based urgency — off-brand",
    severity: "block",
    re: /\b(act now|limited time|don'?t wait|before it'?s too late|time is running out|hurry|urgent(ly)?)\b/i,
  },
  {
    code: "fee",
    scope: "all",
    label: "Fee or price language — off-brand",
    severity: "block",
    re: /\bfree consultation\b|\bno fee\b|\bcontingency\b|\$\s?\d/i,
  },
  {
    code: "state_abbrev",
    scope: "social",
    label: "Spell out New York / New Jersey",
    severity: "block",
    re: /\b(N\.?Y\.?C?|N\.?J\.?)\b/i,
  },
];

const INSTAGRAM_LINK_CTA_RE = /\b(click the link|link below|swipe up)\b|https?:\/\/\S+/i;

/* -------------------------------------------------------------------------- */
/* Item 4 — the Attorney Advertising label and the disclaimer link             */
/* -------------------------------------------------------------------------- */

/**
 * The label, in either form the firm accepts. lib/content-compliance.ts already
 * records that a #AttorneyAdvertising hashtag is an acceptable disclosure on
 * social, so both spellings count here rather than forcing the long form into a
 * caption that is fighting for characters.
 */
const AD_LABEL_RE = /attorney\s*advertising|#attorneyadvertising/i;

/* -------------------------------------------------------------------------- */
/* Item 9 — hyphens, and the hashtag block                                     */
/* -------------------------------------------------------------------------- */

/**
 * Platforms that carry a full hashtag block.
 *
 * LinkedIn is deliberately absent. The generation prompt has said "never
 * carousel slides or LinkedIn beyond 1-2" since the operating brief was
 * written, so requiring four to five there would make the checker contradict
 * the instruction that produced the copy. Diana's rule says "on the channels
 * that use them", and by the firm's own standing rule LinkedIn is not one.
 */
const HASHTAG_BLOCK_PLATFORMS = new Set(["instagram", "facebook", "threads", "tiktok"]);

/** Formats with no hashtag block at all — slides and scripts carry none. */
const NO_HASHTAG_FORMATS = /carousel|slide|script|video|reel/i;

const HASHTAG_RE = /#[A-Za-z0-9_]+/g;
const FIRM_HASHTAG = "#katzmelinger";

/**
 * Blank out the runs a hyphen is allowed to live in, so what remains is prose.
 *
 * Without this the rule fires on the firm's own phone number, on every URL
 * (including the disclaimer link item 4 requires), and on hashtags — three
 * things the brand rule was never aimed at. Replacement preserves length so
 * reported offsets still line up with the original body.
 */
function maskHyphenExemptRuns(body: string): string {
  const blank = (m: string) => " ".repeat(m.length);
  return body
    .replace(/https?:\/\/\S+/gi, blank)
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, blank)
    .replace(/\/[A-Za-z0-9._~\-/]+\//g, blank)
    .replace(PHONE_RE, blank)
    .replace(/#[A-Za-z0-9_-]+/g, blank);
}

/** Run every rule (plus the context-dependent S3 checks) and return the flags that fired. */
export function checkSocialCompliance(text: string, ctx: ComplianceContext = {}): ComplianceFlag[] {
  const body = text ?? "";
  const assetType: AssetType = ctx.assetType ?? "social";
  const isSocial = assetType === "social";
  const flags: ComplianceFlag[] = [];

  for (const r of RULES) {
    if (r.scope === "social" && !isSocial) continue;
    const m = body.match(r.re);
    if (m) {
      flags.push({
        code: r.code,
        label: r.label,
        severity: r.severity,
        excerpt: (m[0] ?? "").trim().slice(0, 40),
      });
    }
  }

  // Known trap: the wrong number leaking into a body — the main office line on
  // social, which must only ever carry the dedicated social number, or (the
  // Unpaid Wages blog) a stale number in a document. Checks EVERY phone-shaped
  // match, not just the first: a body can legitimately open with the correct
  // number and still leak the wrong one later in the text.
  //
  // Keyed by asset type, per Diana's item 6. Social and documents have
  // DIFFERENT correct numbers, so a single check with one expected value was
  // always going to be wrong for one of them.
  const expectedPhone = isSocial ? ctx.socialPhone : ctx.documentPhone;
  if (expectedPhone) {
    const correct = normalizePhone(expectedPhone);
    // A malformed/too-short configured number (correct === null) must not
    // make every real phone number in the body look "wrong" — skip the check
    // entirely rather than false-positive-blocking on a bad setting.
    const wrongPhone =
      correct &&
      [...body.matchAll(PHONE_RE)].find((m) => {
        // Skip a phone-shaped run that's clearly a reference number, not a
        // phone number (a case/docket/invoice number formatted the same way).
        const before = body.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0).toLowerCase();
        if (/(case|docket|claim|invoice|order|index|file)\s*(no\.?|number|#)?\s*:?\s*$/.test(before)) return false;
        return normalizePhone(m[0]) !== correct;
      });
    if (wrongPhone) {
      flags.push({
        code: "wrong_phone",
        label: isSocial
          ? `Wrong phone number on social — must be ${expectedPhone}`
          : `Wrong phone number for a blog or page — must be ${expectedPhone}`,
        severity: "block",
        excerpt: wrongPhone[0].trim().slice(0, 40),
      });
    }
  }

  // ITEM 4 — the Attorney Advertising label, and the general-information
  // disclaimer link. None of the five drafts in the September test carried
  // either, and nothing could hold a draft for their absence.
  //
  // Social only. A blog inherits the site-wide footer block
  // (lib/legal-disclaimers.ts) from the page template, so demanding the label
  // inside the body would flag every compliant post on the site.
  if (isSocial) {
    if (!AD_LABEL_RE.test(body)) {
      flags.push({
        code: "missing_ad_label",
        label: 'Missing the Attorney Advertising label (the words, or #AttorneyAdvertising)',
        severity: "block",
        excerpt: "",
      });
    }
    // Instagram is exempt from the LINK, not the label. A caption link there is
    // dead text — the rule immediately below this one blocks bare URLs on
    // Instagram for exactly that reason, so requiring one here would make the
    // two rules unsatisfiable together.
    if (ctx.disclaimerUrl && ctx.platform !== "instagram" && !body.includes(ctx.disclaimerUrl)) {
      flags.push({
        code: "missing_disclaimer_link",
        label: `Missing the general-information disclaimer link (${ctx.disclaimerUrl})`,
        severity: "block",
        excerpt: "",
      });
    }
  }

  // ITEM 9 — no hyphens outside a phone number, and a consistent hashtag block.
  if (isSocial) {
    const prose = maskHyphenExemptRuns(body);
    const hyphen = prose.match(/\w-\w/);
    if (hyphen) {
      const at = prose.indexOf(hyphen[0]);
      flags.push({
        code: "hyphen",
        label: "Hyphenated term — brand rule is no hyphens outside the phone number",
        severity: "block",
        excerpt: body.slice(Math.max(0, at - 12), at + 20).trim().slice(0, 40),
      });
    }

    const usesHashtagBlock =
      ctx.platform != null &&
      HASHTAG_BLOCK_PLATFORMS.has(ctx.platform) &&
      !(ctx.format && NO_HASHTAG_FORMATS.test(ctx.format));
    const tags = body.match(HASHTAG_RE) ?? [];
    if (usesHashtagBlock && (tags.length < 4 || tags.length > 5)) {
      flags.push({
        code: "hashtag_count",
        label: `Hashtag block must be four to five tags — found ${tags.length}`,
        severity: "block",
        excerpt: tags.join(" ").slice(0, 40),
      });
    }
    // The firm tag is required wherever hashtags are used at all, including the
    // one or two LinkedIn carries — the count rule is what varies by channel,
    // not the signature.
    if (tags.length > 0 && !tags.some((t) => t.toLowerCase() === FIRM_HASHTAG)) {
      flags.push({
        code: "missing_firm_hashtag",
        label: "Hashtag block must include #KatzMelinger",
        severity: "block",
        excerpt: tags.join(" ").slice(0, 40),
      });
    }
  }

  // Instagram captions can't render a clickable link — "click the link" / a
  // bare URL sends the reader nowhere. Steer to "link in bio" instead.
  if (ctx.platform === "instagram") {
    const m = body.match(INSTAGRAM_LINK_CTA_RE);
    if (m) {
      flags.push({
        code: "instagram_link_cta",
        label: 'Instagram caption links don\'t work — use "link in bio", not a URL or "click the link"',
        severity: "block",
        excerpt: m[0].trim().slice(0, 40),
      });
    }
  }

  // A consultation CTA without the offer phrase is a CTA with nothing to invite into.
  //
  // Two flags, not one, because "absent" and "present but reworded" are
  // different problems with different fixes. The offer phrase is a locked
  // string (S1/S2) — "free confidential conversation" and a lowercased
  // "free confidential case review" are both drift, and a case-insensitive
  // match would wave the second one through. Matching case-sensitively first
  // and falling back to case-insensitive tells the reviewer which one it is.
  if (ctx.ctaType === "consultation" && ctx.offerPhrase) {
    if (!body.includes(ctx.offerPhrase)) {
      const loose = body.toLowerCase().indexOf(ctx.offerPhrase.toLowerCase());
      if (loose >= 0) {
        flags.push({
          code: "offer_wording",
          label: `Offer phrase must read exactly "${ctx.offerPhrase}" — check the capitals`,
          severity: "block",
          excerpt: body.slice(loose, loose + ctx.offerPhrase.length),
        });
      } else {
        flags.push({
          code: "missing_offer",
          label: `Consultation CTA is missing the offer ("${ctx.offerPhrase}")`,
          severity: "block",
          excerpt: "",
        });
      }
    }
  }

  return flags;
}

/** True if any blocking flag is present — the post cannot be scheduled. */
export function hasBlockingFlag(text: string, ctx: ComplianceContext = {}): boolean {
  return checkSocialCompliance(text, ctx).some((f) => f.severity === "block");
}
