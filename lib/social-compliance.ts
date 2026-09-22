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
import { checkAudienceAngle } from "./audience-angle";

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
  /** The Spanish companion's locked offer phrase. A Spanish post satisfies the
   *  offer check with EITHER this or the English phrase — a bilingual caption
   *  can legitimately carry either, and a Spanish-only post will never contain
   *  the English one. */
  offerPhraseEs?: string;
  /** Path or URL of the general-information disclaimer page (S3, item 4). */
  disclaimerUrl?: string;
  /** The post's own topic/blog title (S5/6.6) — used to require at least one
   *  of its own significant words appear in the body, not just in hashtags. */
  topic?: string | null;
  /** "employment" or "collections" (spec 1.3) — gates the audience-angle check. */
  practiceArea?: string | null;
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
  // The four RPC/brand rules below match ENGLISH AND SPANISH.
  //
  // They were English-only, and the firm publishes Spanish companions: a
  // caption reading "Garantizamos que ganaremos su caso" passed every one of
  // them silently. That is worse than not checking, because the panel then
  // reports the post clear — which is exactly what a reviewer relies on when
  // they do not read Spanish themselves.
  //
  // Accents are optional in the patterns ([úu], [íi]) because people type
  // without them, and a rule that only catches the correctly-accented spelling
  // catches the careful writer and misses the hurried one.
  {
    code: "guarantee",
    scope: "all",
    label: "Result guarantee — prohibited (RPC 7.1)",
    severity: "block",
    re: /\b(guarantee(d|s)?|we('| wi)ll win|no win,?\s*no fee|100%\s*(win|success|recovery))\b|\b(garantiza(mos|do|da|n)?|garant[íi]a)\b|\bganaremos\b|\bsin\s+honorarios\b|\bsi\s+no\s+gana(mos)?,?\s*no\s+paga\b|\b(sin\s+ganar,?\s*sin\s+(pagar|cobrar))\b|\b100%\s*(de\s*)?([ée]xito|recuperaci[óo]n)\b|\bgarantiz\w*\b/i,
  },
  {
    code: "superlative",
    scope: "all",
    label: "Superlative or specialist claim — prohibited (RPC 7.1 / 7.4)",
    severity: "block",
    // `#1` is pulled out of the \b group (a leading \b can't match before '#').
    // "expert"/"specialist" are only flagged as a self-claim ("we are experts",
    // "specializing in …"), not in legitimate terms like "expert witness".
    // The Spanish half mirrors that, and only that: "el mejor abogado" is a
    // claim, and so is calling the firm's own lawyers the most experienced —
    // which is why that one requires the noun, the way the English rule does.
    // A sentence about experienced WORKERS is not a claim about the firm.
    //
    // "Especializarse en" is deliberately absent. Per Kenneth (2026-09-12), no
    // Spanish phrasing of "specializing in" carries the RPC 7.4 claim the
    // English phrase does, so neither "nos especializamos en" nor
    // "especializados en" belongs here. "Somos expertos" stays: that is a
    // self-claim of expertise, the direct analogue of "we are experts".
    re: /#\s?1\b|\bnumber one\b|\btop[-\s]rated\b|\bbest (lawyer|attorney|law firm|firm)\b|\bleading (law )?firm\b|\bpremier (law )?firm\b|\bwinningest\b|\bmost experienced (lawyer|attorney|firm)\b|\b(we are|we're|our)( the)? (experts?|specialists?)\b|\bspecializ(e|es|ing) in\b|\bn[úu]mero\s+uno\b|\b(el|la|los|las)\s+mejor(es)?\s+(abogad[oa]s?|bufete|firma|despacho)\b|\bbufete\s+l[íi]der\b|\b(somos|nuestros?)\s+(expert[oa]s|especialistas)\b|\b(abogad[oa]s?|bufete|firma|despacho)\s+m[áa]s\s+experimentad[oa]s?\b/i,
  },
  {
    code: "fear",
    scope: "all",
    label: "Fear-based urgency — off-brand",
    severity: "block",
    re: /\b(act now|limited time|don'?t wait|before it'?s too late|time is running out|hurry|urgent(ly)?)\b|\bact[úu]e?\s+ahora\b|\bno\s+espere\b|\btiempo\s+limitado\b|\bantes\s+de\s+que\s+sea\s+demasiado\s+tarde\b|\b(se\s+acaba|se\s+est[áa]\s+acabando)\s+el\s+tiempo\b|\burgente(mente)?\b|\bap[úu]rese\b|\bcon\s+urgencia\b|\bno\s+esper\w*\b/i,
  },
  {
    code: "fee",
    scope: "all",
    label: "Fee or price language — off-brand",
    severity: "block",
    re: /\bfree consultation\b|\bno fee\b|\bcontingency\b|\$\s?\d|\bconsulta\s+(gratis|gratuita)\b|\bsin\s+costo\b|\bhonorarios\s+de\s+contingencia\b|\bsin\s+(cargo|honorarios)\b|\bcuota\s+de\s+contingencia\b/i,
  },
  {
    code: "state_abbrev",
    scope: "social",
    label: "Spell out New York / New Jersey",
    severity: "block",
    re: /\b(N\.?Y\.?C?|N\.?J\.?)\b/i,
  },
];

// S8/6.9: hashtag count + required closing tag. LinkedIn convention is far
// lighter than Instagram/Facebook/X, so it gets its own range rather than
// being exempted outright. Carousel SLIDE text never reaches this function
// (it's checked separately, see lib/image-text-check.ts) — only the caption
// does, and a carousel post's caption follows the same platform rule as any
// other post on that platform.
const HASHTAG_RE = /#[A-Za-z0-9_]+/g;
const KM_HASHTAG_RE = /^#katzmelinger$/i;

function hashtagRange(platform: string | undefined): { min: number; max: number } {
  // "never ... LinkedIn beyond 1-2" (spec 6.9) is an upper bound, not a floor
  // — LinkedIn's own convention is light-to-no hashtags, confirmed against
  // real live posts (every current LinkedIn post has zero and that's normal).
  return platform === "linkedin" ? { min: 0, max: 2 } : { min: 4, max: 5 };
}

const INSTAGRAM_LINK_CTA_RE =
  /\b(click the link|link below|swipe up)\b|\b(haz|haga)\s+clic\s+en\s+el\s+enlace\b|\benlace\s+(abajo|debajo)\b|\bdesliza\s+hacia\s+arriba\b|https?:\/\/\S+/i;

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
 * Formats with no caption hashtag block at all.
 *
 * Spoken scripts only. LinkedIn used to be handled by excluding it from a
 * platform allowlist; hashtagRange() now gives it its own 0-2 range instead,
 * which says the same thing without exempting the channel from the closing-tag
 * rule. Carousel is deliberately NOT here — its caption carries hashtags like
 * any other post, and its slide pixels are checked in lib/image-text-check.ts.
 */
const NO_HASHTAG_FORMATS = /script|video|reel/i;


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

// S5/6.6: AEO and GEO need the location and topic words IN THE BODY — a
// hashtag isn't read as body content by an AI-search engine the way sentence
// text is. A plain "New York"/"New Jersey" word-boundary match already can't
// match a hashtag-smashed form like "#NewYorkLawyer" (no space between the
// words), so no separate hashtag-stripping step is needed.
const LOCATION_RE = /\bNew York\b|\bNew Jersey\b/i;
const LOCATION_RE_ES = /\bNueva York\b|\bNueva Jersey\b/i;

const TOPIC_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "your", "into",
  "about", "over", "under", "what", "when", "where", "does", "have", "will",
  "can", "are", "was", "you", "how", "why", "new", "york", "jersey", "nyc",
  "nj", "law", "lawyer", "lawyers", "attorney", "attorneys",
]);

/** Significant words from a topic/title — 4+ letters, not a stopword,
 *  de-duplicated. Deliberately loose: this only needs ONE hit in the body to
 *  pass, so a short, imprecise list is fine — it can't cause a false block. */
function significantWords(topic: string): string[] {
  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !TOPIC_STOPWORDS.has(w));
  return [...new Set(words)];
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
        if (
          /(case|docket|claim|invoice|order|index|file|caso|expediente|reclamo|factura|orden|archivo)\s*(no\.?|number|n(ú|u)mero|num\.?|#)?\s*:?\s*$/.test(
            before,
          )
        )
          return false;
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

    // Count and closing tag come from the platform range (LinkedIn runs far
    // lighter than Instagram/Facebook), and the firm tag must be the LAST one
    // — the operating brief's hashtagRule and Diana's 6.9 both say "ending
    // with #KatzMelinger", not merely "including" it.
    //
    // Scripts are exempt: video_short is spoken copy with no caption block at
    // all, so a range check there flags every compliant script. A carousel is
    // NOT exempt — only its caption reaches this function (slide pixels go to
    // lib/image-text-check.ts) and that caption carries hashtags like any other.
    const carriesHashtagBlock = !(ctx.format && NO_HASHTAG_FORMATS.test(ctx.format));
    if (carriesHashtagBlock && body.trim().length > 0) {
      const tags = body.match(HASHTAG_RE) ?? [];
      const { min, max } = hashtagRange(ctx.platform);
      if (tags.length < min || tags.length > max) {
        flags.push({
          code: "hashtag_count",
          label: `Needs ${min}-${max} hashtags (found ${tags.length})`,
          severity: "block",
          excerpt: tags.join(" ").slice(0, 40),
        });
      } else if (tags.length > 0 && !KM_HASHTAG_RE.test(tags[tags.length - 1])) {
        flags.push({
          code: "hashtag_ending",
          label: "Hashtags must end with #KatzMelinger",
          severity: "block",
          excerpt: tags[tags.length - 1],
        });
      }
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
  if (ctx.ctaType === "consultation" && (ctx.offerPhrase || ctx.offerPhraseEs)) {
    // Either locked phrase satisfies it. Check them in order and stop at the
    // first exact hit, so a bilingual caption carrying the English phrase is
    // not then failed for the Spanish one it also has, correctly, in full.
    const locked = [ctx.offerPhrase, ctx.offerPhraseEs].filter(
      (s): s is string => !!s && !!s.trim(),
    );
    if (!locked.some((phrase) => body.includes(phrase))) {
      // Report against whichever phrase is closest to being right — the one the
      // post already has in some casing — so the fix names the drifted string
      // rather than an unrelated language's phrase.
      const drifted =
        locked.find((phrase) => body.toLowerCase().includes(phrase.toLowerCase())) ?? locked[0];
      const loose = body.toLowerCase().indexOf(drifted.toLowerCase());
      if (loose >= 0) {
        flags.push({
          code: "offer_wording",
          label: `Offer phrase must read exactly "${drifted}" — check the capitals`,
          severity: "block",
          excerpt: body.slice(loose, loose + drifted.length),
        });
      } else {
        flags.push({
          code: "missing_offer",
          label: `Consultation CTA is missing the offer ("${drifted}")`,
          severity: "block",
          excerpt: "",
        });
      }
    }
  }

  // S5/6.6: a consultation post needs its own location and topic words in the
  // body — the audience an AEO/GEO answer engine reads is the sentence text,
  // not the hashtag block. Gated the same way missing_offer is (consultation
  // CTAs only) since that's the concrete case the spec's done-when names.
  if (ctx.ctaType === "consultation") {
    if (!LOCATION_RE.test(body) && !LOCATION_RE_ES.test(body)) {
      flags.push({
        code: "missing_location",
        label: "Consultation post is missing the location (New York / New Jersey) in the body",
        severity: "block",
        excerpt: "",
      });
    }
    if (ctx.topic) {
      const words = significantWords(ctx.topic);
      const lower = body.toLowerCase();
      if (words.length > 0 && !words.some((w) => lower.includes(w))) {
        flags.push({
          code: "missing_target_term",
          // Fuzzy on purpose (see significantWords) — a miss here is worth a
          // second look, not a certain problem, so it warns rather than blocks.
          label: `Body doesn't mention this post's own topic ("${ctx.topic}")`,
          severity: "warn",
          excerpt: "",
        });
      }
    }
  }

  // 1.3: never address the audience the firm does NOT represent in this
  // practice area — the live trap was a wage-theft (employment) post reading
  // "For employers: this is a wake-up call to review payroll practices
  // immediately." Narrow and pattern-based on purpose (see audience-angle.ts):
  // this catches a direct wrong-audience callout, not general mentions of
  // "employers" (a post can accurately say "employers must pay overtime" while
  // still being written to the employee reader).
  const angleHit = checkAudienceAngle(body, ctx.practiceArea);
  if (angleHit) {
    flags.push({
      code: "wrong_audience_angle",
      label:
        ctx.practiceArea === "employment"
          ? "Addresses employers on an employment topic — must be written to the employee"
          : "Addresses the debtor on a collections topic — must be written to the creditor",
      severity: "block",
      excerpt: angleHit.matched,
    });
  }

  return flags;
}

/** True if any blocking flag is present — the post cannot be scheduled. */
export function hasBlockingFlag(text: string, ctx: ComplianceContext = {}): boolean {
  return checkSocialCompliance(text, ctx).some((f) => f.severity === "block");
}
