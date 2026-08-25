/**
 * Fee and contingency language — a hard firm rule, checked deterministically.
 *
 * The rule (Diana, 2026-08-25 §6): no content may state or imply how the firm
 * charges. No contingency fees, no "no fee unless you win", no "you do not pay
 * unless you recover". A free initial consultation MAY be mentioned; fee
 * arrangements may not.
 *
 * Why this is not left to the compliance model: that check is a prompt, and a
 * prompt is probabilistic. This rule is absolute, and the phrasings are a small
 * closed set that a pattern matches exactly every time. The model still runs
 * alongside and will catch paraphrases this misses — but the obvious wordings
 * can never slip through on a bad sampling day.
 *
 * Nothing in the existing attorney-advertising checker covered this. It flags
 * superlatives, outcome guarantees, and missing disclaimers; fee arrangements
 * were simply not in its failure-mode list, which is why the rule needed
 * writing rather than tightening.
 *
 * Pure module: no IO, no model, so it is unit-testable and cheap enough to run
 * on every draft.
 */

export type FeeLanguageHit = {
  /** Which pattern fired, for the reviewer and for grouping. */
  rule: string;
  /** The matched text. */
  match: string;
  /** The sentence it sits in, so a reviewer can judge without opening the draft. */
  sentence: string;
  index: number;
};

/**
 * Phrasings that state or imply a fee arrangement.
 *
 * Ordered most-specific first so the reported rule name is the useful one when
 * several could match the same sentence.
 */
const BANNED: { rule: string; re: RegExp }[] = [
  // "contingency" in legal marketing is always the fee sense. Bare "contingent"
  // is NOT — "an offer contingent on your start date" is ordinary employment
  // prose, and matching it put clean drafts on the worklist. Only the explicit
  // "contingent fee" form counts.
  { rule: "Contingency fee", re: /\bcontingency\b|\bcontingent[-\s]fee\b/gi },
  { rule: "No fee unless you win", re: /\bno\s+(?:fee|fees|cost|costs|charge)\s+unless\b/gi },
  { rule: "No win, no fee", re: /\bno\s+(?:win|recovery)\s*,?\s*no\s+(?:fee|fees|pay)\b/gi },
  { rule: "You pay nothing unless", re: /\byou\s+(?:pay|owe)\s+nothing\s+unless\b/gi },
  {
    rule: "You do not pay unless",
    re: /\byou\s+(?:do\s+not|don['’]t|will\s+not|won['’]t)\s+pay\s+(?:us\s+)?unless\b/gi,
  },
  {
    rule: "We are not paid unless",
    re: /\bwe\s+(?:do\s+not|don['’]t|only)\s+get\s+paid\s+(?:unless|if|when)\b/gi,
  },
  { rule: "Only pay if we win", re: /\b(?:only\s+)?pay\s+(?:us\s+)?(?:only\s+)?if\s+we\s+(?:win|recover)\b/gi },
  {
    rule: "Percentage of recovery",
    re: /\b(?:\d{1,2}\s*(?:%|percent)|percentage)\s+of\s+(?:your|the|any)\s+(?:recovery|settlement|award|verdict)\b/gi,
  },
  // Proximity rather than a fixed verb: "is deducted from", "comes out of",
  // "will be taken from" are all the same claim, and enumerating the verbs
  // missed the commonest one. Bounded to 30 characters and stopped at a
  // sentence end so it cannot reach across unrelated clauses.
  {
    rule: "Fee taken from recovery",
    re: /\b(?:fee|fees)\b[^.]{0,30}?\b(?:from|out\s+of)\s+(?:your|the|any)\s+(?:recovery|settlement|award|verdict)\b/gi,
  },
  { rule: "No upfront cost", re: /\bno\s+(?:up[-\s]?front|upfront|out[-\s]?of[-\s]?pocket)\s+(?:cost|costs|fee|fees|payment)\b/gi },
];

/**
 * Phrasings that must NOT be flagged. A free consultation is expressly allowed,
 * and it lives in the same neighbourhood of words as the banned patterns — so
 * without this the rule would fire on the one fee-adjacent thing the firm is
 * permitted to say, and get switched off.
 */
const ALLOWED = [
  /\bfree\s+(?:initial\s+)?(?:consultation|case\s+(?:evaluation|review)|assessment)\b/gi,
  /\bconsultations?\s+(?:are|is)\s+free\b/gi,
];

function sentenceAround(body: string, index: number): string {
  const start = body.lastIndexOf(".", index);
  const nextStop = body.indexOf(".", index);
  const from = start === -1 ? Math.max(0, index - 140) : start + 1;
  const to = nextStop === -1 ? Math.min(body.length, index + 140) : nextStop + 1;
  return body.slice(from, to).replace(/\s+/g, " ").trim();
}

/** Does this span sit inside an expressly permitted phrase? */
function isAllowed(body: string, index: number, length: number): boolean {
  for (const re of ALLOWED) {
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      if (index >= s && index + length <= e) return true;
    }
  }
  return false;
}

/** Every fee-arrangement phrasing in this text. Empty array means clean. */
export function findFeeLanguage(body: string): FeeLanguageHit[] {
  if (!body) return [];
  const hits: FeeLanguageHit[] = [];
  const claimed = new Set<number>();

  for (const { rule, re } of BANNED) {
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) {
      const index = m.index ?? 0;
      // One hit per span: the patterns deliberately overlap, and reporting the
      // same sentence three times reads as three problems.
      if (claimed.has(index)) continue;
      if (isAllowed(body, index, m[0].length)) continue;
      claimed.add(index);
      hits.push({ rule, match: m[0], sentence: sentenceAround(body, index), index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** The rule as prose, for the compliance prompt and for reviewer-facing text. */
export const FEE_LANGUAGE_RULE =
  "FEE ARRANGEMENTS (firm rule, absolute): content must never state or imply how the firm charges. " +
  "No contingency fees, no \"no fee unless you win\", no \"you do not pay unless you recover\", no " +
  "percentage-of-recovery figures, no \"no upfront cost\". A free initial consultation MAY be " +
  "mentioned — that is the only fee-adjacent statement permitted.";
