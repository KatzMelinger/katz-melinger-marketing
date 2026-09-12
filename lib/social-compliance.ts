/**
 * Fast, deterministic brand + attorney-advertising checks for the social
 * composer's approval gate. Pure and client-safe (no server imports), so the
 * composer can flag a variation live as it's edited and block scheduling until
 * it's cleared — the "brand or compliance flag" the spec requires.
 *
 * This is the cheap, always-on floor. It encodes the same failure modes the
 * LLM compliance reviewer (lib/compliance-core.ts) enforces on publish, plus
 * the Katz Melinger brand rules (no dashes, no fear-based urgency, no fee
 * language, New York / New Jersey spelled out). It is intentionally strict on
 * high-confidence patterns and silent on judgment calls, so a block is almost
 * always a real problem.
 */

import { normalizePhone } from "./lead-response";

export type FlagSeverity = "block" | "warn";

export type ComplianceFlag = {
  code: string;
  label: string;
  severity: FlagSeverity;
  /** The offending text, for display. */
  excerpt: string;
};

type ComplianceContext = {
  /** The correct social phone number (e.g. from the operating brief). Any other phone-shaped match is flagged. */
  socialPhone?: string;
  /** The channel this post is for — gates the Instagram-link-CTA check. */
  platform?: string;
  /** This post's chosen CTA type — gates the missing-offer check. */
  ctaType?: string;
  /** The operating brief's offer phrase, required when ctaType is "consultation". */
  offerPhrase?: string;
  /** The Spanish companion's offer phrase — a Spanish post satisfies
   *  missing_offer with EITHER this or the English offerPhrase, since the
   *  English one can legitimately appear in a bilingual caption. */
  offerPhraseEs?: string;
};

// `re` and `reEs` are tested independently and unconditionally — a post is
// checked against BOTH regardless of what language it's actually in, rather
// than trying to detect language first. Cheaper and safer: a wrong language
// guess can never suppress a real check, it can only ever add coverage.
type Rule = { code: string; label: string; severity: FlagSeverity; re: RegExp; reEs?: RegExp };

/** US phone number in any common written form: (212) 460-0047, 212-460-0047, 212.460.0047, 2124600047. */
const PHONE_RE = /(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]?\d{4}/g;

// Order matters only for display. Each `re` has a capture/target used as the
// excerpt. All case-insensitive unless the pattern is inherently cased.
const RULES: Rule[] = [
  {
    code: "dash",
    label: "Em or en dash — brand rule is no dashes",
    severity: "block",
    re: /[‒–—―]|\s--\s/,
  },
  {
    code: "guarantee",
    label: "Result guarantee — prohibited (RPC 7.1)",
    severity: "block",
    re: /\b(guarantee(d|s)?|we('| wi)ll win|no win,?\s*no fee|100%\s*(win|success|recovery))\b/i,
    reEs: /\b(garantiz\w*|ganaremos (su|el) caso|sin ganar,?\s*sin (pagar|cobrar)|100%\s*(de\s*)?(éxito|recuperación))\b/i,
  },
  {
    code: "superlative",
    label: "Superlative or specialist claim — prohibited (RPC 7.1 / 7.4)",
    severity: "block",
    // `#1` is pulled out of the \b group (a leading \b can't match before '#').
    // "expert"/"specialist" are only flagged as a self-claim ("we are experts",
    // "specializing in …"), not in legitimate terms like "expert witness".
    re: /#\s?1\b|\bnumber one\b|\btop[-\s]rated\b|\bbest (lawyer|attorney|law firm|firm)\b|\bleading (law )?firm\b|\bpremier (law )?firm\b|\bwinningest\b|\bmost experienced (lawyer|attorney|firm)\b|\b(we are|we're|our)( the)? (experts?|specialists?)\b|\bspecializ(e|es|ing) in\b/i,
    reEs: /\bn(ú|u)mero uno\b|\b(el|los)\s+mejor(es)?\s+(abogados?|bufete)\b|\bfirma\s+l(í|i)der\b|\bm(á|a)s\s+experimentados?\b|\bsomos\s+expertos\b|\besp(e|é)cialistas?\s+en\b|\bespecializados?\s+en\b/i,
  },
  {
    code: "fear",
    label: "Fear-based urgency — off-brand",
    severity: "block",
    re: /\b(act now|limited time|don'?t wait|before it'?s too late|time is running out|hurry|urgent(ly)?)\b/i,
    reEs: /\bact(ú|u)e\s+ahora\b|\btiempo\s+limitado\b|\bno\s+esper\w*\b|\bantes\s+de\s+que\s+sea\s+demasiado\s+tarde\b|\bcon\s+urgencia\b|\burgente(mente)?\b/i,
  },
  {
    code: "fee",
    label: "Fee or price language — off-brand",
    severity: "block",
    re: /\bfree consultation\b|\bno fee\b|\bcontingency\b|\$\s?\d/i,
    reEs: /\bconsulta\s+gratu?ita\b|\bsin\s+(costo|cargo|honorarios)\b|\bcuota\s+de\s+contingencia\b/i,
  },
  {
    code: "state_abbrev",
    label: "Spell out New York / New Jersey",
    severity: "block",
    re: /\b(N\.?Y\.?C?|N\.?J\.?)\b/i,
  },
];

const INSTAGRAM_LINK_CTA_RE =
  /\b(click the link|link below|swipe up|haz clic en el enlace|enlace (de )?abajo|desliza hacia arriba)\b|https?:\/\/\S+/i;

/** Run every rule (plus the context-dependent S3 checks) and return the flags that fired. */
export function checkSocialCompliance(text: string, ctx: ComplianceContext = {}): ComplianceFlag[] {
  const body = text ?? "";
  const flags: ComplianceFlag[] = [];
  for (const r of RULES) {
    const m = body.match(r.re) ?? (r.reEs ? body.match(r.reEs) : null);
    if (m) {
      flags.push({
        code: r.code,
        label: r.label,
        severity: r.severity,
        excerpt: (m[0] ?? "").trim().slice(0, 40),
      });
    }
  }

  // Known trap: the main office line (or any other number) leaking onto social,
  // which must only ever carry the dedicated social number. Checks EVERY
  // phone-shaped match, not just the first — a caption can legitimately open
  // with the correct number and still leak the wrong one later in the text.
  if (ctx.socialPhone) {
    const correct = normalizePhone(ctx.socialPhone);
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
        label: `Wrong phone number on social — must be ${ctx.socialPhone}`,
        severity: "block",
        excerpt: wrongPhone[0].trim().slice(0, 40),
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

  // A consultation CTA without the offer phrase is a CTA with nothing to invite
  // into. Either the English or the Spanish locked phrase satisfies it — a
  // Spanish post won't contain the English one, and a bilingual caption might
  // legitimately contain either.
  if (ctx.ctaType === "consultation" && (ctx.offerPhrase || ctx.offerPhraseEs)) {
    const lower = body.toLowerCase();
    const hasOffer =
      (ctx.offerPhrase && lower.includes(ctx.offerPhrase.toLowerCase())) ||
      (ctx.offerPhraseEs && lower.includes(ctx.offerPhraseEs.toLowerCase()));
    if (!hasOffer) {
      flags.push({
        code: "missing_offer",
        label: `Consultation CTA is missing the offer ("${ctx.offerPhrase ?? ctx.offerPhraseEs}")`,
        severity: "block",
        excerpt: "",
      });
    }
  }

  return flags;
}

/** True if any blocking flag is present — the post cannot be scheduled. */
export function hasBlockingFlag(text: string, ctx: ComplianceContext = {}): boolean {
  return checkSocialCompliance(text, ctx).some((f) => f.severity === "block");
}
