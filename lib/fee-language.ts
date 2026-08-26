/**
 * Fee and contingency language — a hard firm rule, checked deterministically.
 *
 * The rule (Diana, 2026-08-25 §6, refined 2026-08-26): no content may state or
 * imply how KATZ MELINGER charges. The firm is flat-fee and has never worked on
 * contingency, so "we work on contingency" is not merely off-policy, it is
 * false.
 *
 * But the rule is about the FIRM, not about the word. "Most employment lawyers
 * handle overtime cases on contingency" describes the market, is accurate, and
 * stays — blocking it would gut legitimate legal education, which is most of
 * what the library is for. So every hit is classified by who the sentence is
 * about:
 *
 *   firm       the sentence names the firm or uses we/our/us   -> BLOCKS
 *   general    the sentence is about other lawyers or the market -> allowed
 *   ambiguous  no clear subject (usually a passive construction) -> REVIEW
 *
 * Ambiguous goes to a human rather than to either extreme. Diana's instruction
 * is explicit: borderline cases go to review, never auto-block.
 *
 * A free initial consultation MAY be mentioned; fee arrangements may not. When
 * removing fee language, DELETE the reference — do not substitute "flat fee",
 * because that is still telling the reader how the firm charges.
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

/** Who the sentence is about — which decides whether the hit blocks. */
export type FeeSubject = "firm" | "general" | "ambiguous";

export type FeeLanguageHit = {
  /** Which pattern fired, for the reviewer and for grouping. */
  rule: string;
  /** firm blocks; general is permitted; ambiguous routes to a human. */
  subject: FeeSubject;
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

/** The sentence is about Katz Melinger. First person counts — it is our site. */
const FIRM_SUBJECT =
  /\b(?:we|we['’]re|our|us|the\s+firm|this\s+firm|Katz\s+Melinger|our\s+(?:firm|attorneys|lawyers|team))\b/i;

/**
 * The sentence is about other lawyers or the market generally.
 *
 * Requires an explicit third-party subject — "most employment lawyers", "some
 * attorneys", "many firms". A bare passive ("cases are handled on contingency")
 * does NOT qualify: on the firm's own site a reader may fairly read that as the
 * firm's own practice, which is exactly the borderline Diana routed to a human.
 */
const GENERAL_SUBJECT =
  /\b(?:most|many|some|other|certain|typical(?:ly)?|generally|often|usually)\s+(?:\w+\s+){0,2}?(?:lawyers?|attorneys?|law\s+firms?|firms?|practitioners?)\b|\b(?:lawyers?|attorneys?|law\s+firms?)\s+(?:in\s+(?:New\s+York|NYC|New\s+Jersey)\s+)?(?:often|typically|generally|usually|may|can|will)\b/i;

/**
 * Who is this sentence about?
 *
 * Firm reference wins outright: a sentence that mentions both the market and the
 * firm ("many lawyers work on contingency, and we do too") is a firm claim, and
 * treating it as market commentary would let the exact wrong sentence through.
 */
export function classifyFeeSubject(sentence: string): FeeSubject {
  if (FIRM_SUBJECT.test(sentence)) return "firm";
  if (GENERAL_SUBJECT.test(sentence)) return "general";
  return "ambiguous";
}

/**
 * Every fee-arrangement phrasing in this text, each classified by subject.
 *
 * Returns `general` hits too — the caller decides what to do with them. The
 * compliance gate ignores them; a library sweep still wants to count them so a
 * reviewer can confirm the classification is behaving.
 */
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
      const sentence = sentenceAround(body, index);
      hits.push({
        rule,
        subject: classifyFeeSubject(sentence),
        match: m[0],
        sentence,
        index,
      });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Hits that must block: the firm's own fee arrangements. */
export function blockingFeeHits(hits: readonly FeeLanguageHit[]): FeeLanguageHit[] {
  return hits.filter((h) => h.subject === "firm");
}

/** Hits a human should look at, without failing the draft. */
export function reviewableFeeHits(hits: readonly FeeLanguageHit[]): FeeLanguageHit[] {
  return hits.filter((h) => h.subject === "ambiguous");
}

/** The rule as prose, for the compliance prompt and for reviewer-facing text. */
export const FEE_LANGUAGE_RULE =
  "FEE ARRANGEMENTS (firm rule): content must never state or imply how KATZ MELINGER charges. " +
  "The firm is flat-fee and has never worked on contingency, so any claim that it does is false. " +
  "Flag: contingency, \"no fee unless you win\", \"you do not pay unless you recover\", " +
  "percentage-of-recovery figures, \"no upfront cost\" — WHEN the sentence is about this firm " +
  "(we/our/the firm/Katz Melinger). " +
  "Do NOT flag accurate general statements about other lawyers or the market, e.g. \"most " +
  "employment lawyers handle overtime cases on contingency\" — those are legitimate legal " +
  "education and stay. A free initial consultation MAY be mentioned. When removing fee language, " +
  "delete the reference; do not substitute \"flat fee\", which still tells the reader how the " +
  "firm charges.";
