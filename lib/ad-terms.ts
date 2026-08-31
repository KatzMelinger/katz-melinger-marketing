/**
 * Attorney-advertising terms — a hard rule, checked deterministically.
 *
 * NY RPC 7.4 and NJ RPC 7.4(a) forbid holding the firm out as an "expert" or
 * "specialist" without a certification Katz Melinger does not hold. RPC 7.1(a)
 * forbids comparative claims that cannot be substantiated. RPC 7.1 forbids
 * predicting or guaranteeing a result.
 *
 * lib/compliance-core.ts has always STATED these rules — but as prose inside a
 * model prompt, and only against draft bodies. On 2026-08-31 the metadata
 * backfill produced fifteen descriptions calling the firm an "expert". The
 * system knew the rule and broke it fifteen times in one run. A prompt is a
 * request; this is the rule.
 *
 * THE RULE IS ABOUT THE FIRM, NOT ABOUT THE WORD
 *
 * This is the whole design problem, and it is the same one fee-language.ts
 * solved. A blanket word list run against the library produces 62 hits, and
 * nearly every one is legitimate:
 *
 *   "work with experts to build your case"        expert witnesses, a term of art
 *   "in your best interest before you sign"       ordinary English
 *   "the months leading up to your termination"   temporal
 *   "the New York Labor Law builds on top of it"  a preposition
 *   "a lawyer who guarantees a result is a red flag"   the OPPOSITE of a violation
 *
 * Blocking those would gut the educational writing that is most of what the
 * library is for, and a check that cries wolf sixty times is a check everyone
 * learns to click past. So the patterns encode what the rules actually prohibit:
 *
 *   credential   "expert"/"specialist" describing the firm or its lawyers.
 *                Exempt when it names an expert WITNESS or expert testimony.
 *   superlative  fires only when the word DIRECTLY modifies a firm noun —
 *                "the best employment lawyer", not "the best path forward".
 *   guarantee    fires only on an affirmative promise of outcome. Negations
 *                ("cannot guarantee", "no guarantee") are disclaimers, which
 *                are the correct thing to write.
 *
 * Then each surviving hit is classified by who the sentence is about, exactly
 * as the fee rule does, and ambiguous goes to a human rather than to either
 * extreme.
 *
 * Pure module: no IO, no model. Unit-testable, cheap enough to run everywhere.
 */

/** Who the sentence is about — which decides whether the hit blocks. */
export type AdSubject = "firm" | "general" | "ambiguous";

export type AdTermHit = {
  /** Which rule fired. */
  rule: "credential" | "superlative" | "guarantee";
  /** The rule text, so a reviewer is told the rule and not just the word. */
  why: string;
  /** firm blocks; general is permitted; ambiguous routes to a human. */
  subject: AdSubject;
  match: string;
  sentence: string;
  index: number;
};

/** Nouns that mean "the firm or its lawyers" for the purposes of these rules. */
const FIRM_NOUN =
  "(?:lawyers?|attorneys?|counsel|law\\s+firms?|firms?|practices?|legal\\s+teams?|representation|advocates?)";

const RULES: { rule: AdTermHit["rule"]; why: string; re: RegExp }[] = [
  {
    rule: "credential",
    why: 'RPC 7.4 — "expert"/"specialist" requires a certification the firm does not hold',
    // Any use of the credential words. The expert-witness senses are carved out
    // by EXEMPT rather than by a lookahead here, so the carve-out is visible and
    // testable in one place instead of buried inside a pattern.
    re: /\b(?:experts?|expertise|specialists?|specializ(?:e|es|ed|ing))\b/gi,
  },
  {
    rule: "superlative",
    why: "RPC 7.1(a) — comparative claim that cannot be factually substantiated",
    // Must DIRECTLY modify a firm noun: "best employment lawyer", "top-rated
    // firm", "premier NYC attorneys". Up to three intervening words allows the
    // adjectives these phrases always carry ("best employment discrimination
    // lawyer") without reaching across a clause boundary into an unrelated noun.
    re: new RegExp(
      "\\b(?:best|top(?:[-\\s]rated|[-\\s]ranked)?|#\\s*1|number\\s+one|premier|leading|finest|foremost|unmatched|unrivall?ed|most\\s+(?:experienced|trusted|successful|aggressive))\\b" +
        "(?:[-\\s]\\w+){0,3}?[-\\s]" +
        FIRM_NOUN,
      "gi",
    ),
  },
  {
    rule: "guarantee",
    why: "RPC 7.1 — prediction or guarantee of a result",
    // Affirmative promises only. "We cannot guarantee an outcome" is the
    // disclaimer the rules WANT, and must never be flagged.
    re: new RegExp(
      "\\b(?:guaranteed?\\s+(?:results?|outcomes?|recover(?:y|ies)|settlements?|success|win)" +
        "|results?\\s+guaranteed" +
        "|risk[-\\s]free" +
        "|no\\s+risk\\b" +
        "|we\\s+(?:will\\s+)?win\\s+your\\s+case" +
        "|(?:we|our\\s+firm|our\\s+attorneys?|Katz\\s+Melinger)\\s+(?:can\\s+|will\\s+)?guarantees?\\b)",
      "gi",
    ),
  },
];

/**
 * Spans that are expressly permitted, checked before any hit is reported.
 *
 * These are not edge cases; they are the majority of what a bare word list finds
 * in real legal writing.
 */
const EXEMPT: { note: string; re: RegExp }[] = [
  {
    note: "expert witness / expert testimony — a term of art, not a credential claim",
    re: /\bexperts?\s+(?:witness(?:es)?|testimon(?:y|ies)|reports?|opinions?|discovery|analysis|evaluations?|fees?|depositions?)\b/gi,
  },
  {
    note: "retaining an outside expert — 'work with experts', 'hire an expert'",
    re: /\b(?:work(?:ing|s|ed)?\s+with|hir(?:e|ing|ed)|retain(?:s|ing|ed)?|consult(?:s|ing|ed)?|need(?:s|ed)?|use\s+of|pay(?:ing|s)?\s+for|costs?\s+of|guidance\s+from|testimony\s+from|advice\s+from)\s+(?:an?\s+|the\s+)?(?:\w+\s+){0,2}?experts?\b/gi,
  },
  {
    note: "negated guarantee — a disclaimer, which is the correct thing to write",
    re: /\b(?:no|not|never|cannot|can[’']t|won[’']t|will\s+not|does\s+not|doesn[’']t|do\s+not|don[’']t|may\s+not|isn[’']t|without)\s+(?:\w+\s+){0,2}?guarantees?\b/gi,
  },
  {
    note: "a warning ABOUT lawyers who guarantee results — the opposite of a violation",
    re: /\b(?:red\s+flag|beware|avoid|wary\s+of|careful\s+of|any\s+lawyer|a\s+lawyer|lawyers?|attorneys?)\s+(?:\w+\s+){0,6}?guarantees?\b/gi,
  },
  {
    // "Hold a title like manager, supervisor, coordinator, analyst, or specialist"
    // is an FLSA exemption test, not a credential claim. This fired as BLOCKING
    // in the first sweep, which is exactly the kind of false positive that
    // teaches a reviewer to stop reading the flags.
    note: "'specialist' as an employee JOB TITLE, not a claim about the firm",
    re: /\b(?:titles?|positions?|roles?|job\s+titles?)\b[^.]{0,120}?\bspecialists?\b|\b(?:manager|supervisor|administrator|coordinator|analyst|director|associate)s?,\s*(?:\w+\s*,\s*)*(?:or\s+)?specialists?\b/gi,
  },
  {
    note: "'specialized' as an ordinary adjective — training, knowledge, equipment",
    re: /\bspecialized\s+(?:knowledge|training|skills?|experience|equipment|degrees?|certifications?|courts?|units?|education|study|fields?)\b/gi,
  },
  {
    // "guidance from medical experts", "we work with financial experts". A
    // domain adjective in front of "expert" means an outside professional in
    // that field, never the firm's own credential.
    note: "a domain expert — medical, financial, vocational, forensic",
    re: /\b(?:medical|financial|forensic|vocational|economic|industry|outside|independent|third[-\s]party|damages|accounting|tax|technical|handwriting|IT|computer)\s+experts?\b/gi,
  },
  {
    note: "'best practices' — an idiom, not a claim about the firm",
    re: /\bbest\s+practices?\b/gi,
  },
  {
    // Best Lawyers, Super Lawyers, Best Law Firms are the NAMES of rating
    // publications. Stating an award the firm actually received is a fact, not
    // an unsubstantiable comparative claim.
    //
    // NOTE: naming a rating carries its OWN obligations under RPC 7.1 —
    // the rating's basis and a disclaimer may be required. That is a separate
    // check this module does not perform, and the sweep says so rather than
    // letting an exemption here read as "the award badges are fine".
    note: "the NAME of a rating publication — a factual award, not a comparative claim",
    re: /\b(?:Best\s+Lawyers|Super\s+Lawyers|Best\s+Law\s+Firms|Top\s+Lawyers|Rising\s+Stars)\b/g,
  },
  {
    note: "a contract or statute guaranteeing a term — not an outcome promise",
    re: /\b(?:contract|agreement|statute|law|policy|plan|handbook|offer)\s+guarantees?\b/gi,
  },
];

function sentenceAround(body: string, index: number): string {
  const start = body.lastIndexOf(".", index);
  const nextStop = body.indexOf(".", index);
  const from = start === -1 ? Math.max(0, index - 140) : start + 1;
  const to = nextStop === -1 ? Math.min(body.length, index + 140) : nextStop + 1;
  return body.slice(from, to).replace(/\s+/g, " ").trim();
}

/** Does this span sit inside an expressly permitted phrase? */
function isExempt(body: string, index: number, length: number): boolean {
  for (const { re } of EXEMPT) {
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) {
      const s = m.index ?? 0;
      if (index >= s && index + length <= s + m[0].length) return true;
    }
  }
  return false;
}

/** The sentence is about Katz Melinger. First person counts — it is our site. */
const FIRM_SUBJECT = /\b(?:we|we[’']re|our|us|the\s+firm|this\s+firm|Katz\s+Melinger)\b/i;

/**
 * The sentence is about other lawyers, the employer, or the market.
 *
 * As with the fee rule, a bare passive does NOT qualify: on the firm's own site
 * a reader may fairly read an unattributed claim as the firm's own.
 */
const GENERAL_SUBJECT =
  /\b(?:most|many|some|other|another|certain|typical(?:ly)?|generally|often|usually)\s+(?:\w+\s+){0,2}?(?:lawyers?|attorneys?|law\s+firms?|firms?|practitioners?|counsel)\b|\b(?:employers?|opposing\s+counsel|your\s+employer)\b/i;

/**
 * Who is this sentence about?
 *
 * Firm reference wins outright: a sentence naming both ("many firms say this,
 * and we are the best") is a firm claim, and reading it as market commentary
 * would let precisely the wrong sentence through.
 */
export function classifyAdSubject(sentence: string): AdSubject {
  if (FIRM_SUBJECT.test(sentence)) return "firm";
  if (GENERAL_SUBJECT.test(sentence)) return "general";
  return "ambiguous";
}

/** Every advertising-rule problem in this text, each classified by subject. */
export function findAdTerms(body: string): AdTermHit[] {
  if (!body) return [];
  const hits: AdTermHit[] = [];
  const claimed = new Set<number>();

  for (const { rule, why, re } of RULES) {
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) {
      const index = m.index ?? 0;
      if (claimed.has(index)) continue;
      if (isExempt(body, index, m[0].length)) continue;
      claimed.add(index);
      const sentence = sentenceAround(body, index);
      hits.push({ rule, why, subject: classifyAdSubject(sentence), match: m[0], sentence, index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Hits that must block: the claim is about this firm. */
export function blockingAdHits(hits: readonly AdTermHit[]): AdTermHit[] {
  return hits.filter((h) => h.subject === "firm");
}

/** Hits a human should look at, without failing the draft. */
export function reviewableAdHits(hits: readonly AdTermHit[]): AdTermHit[] {
  return hits.filter((h) => h.subject === "ambiguous");
}

/**
 * Violations in SHORT MARKETING COPY — a meta description, a social caption, a
 * GBP post, an ad headline.
 *
 * Here ambiguous blocks too. In a long article an unattributed sentence may
 * genuinely be about the market; in a 155-character description written to sell
 * the firm, every sentence is about the firm, and there is no surrounding text
 * that could make it mean anything else.
 */
export function marketingCopyViolations(text: string): AdTermHit[] {
  return findAdTerms(text).filter((h) => h.subject !== "general");
}

/** The rules as prose, for model prompts that generate firm-facing copy. */
export const AD_TERMS_RULE = [
  "ATTORNEY ADVERTISING RULES — not style preferences. This is regulated speech under",
  "NY 22 NYCRR Part 1200 and the NJ RPCs:",
  '- NEVER call the firm or its lawyers an "expert" or "specialist", and never use',
  '  "expertise" or "specializing in". RPC 7.4 permits those only with a certification',
  '  this firm does not hold. Write "experienced", or simply name the practice area.',
  '- NEVER use a superlative or comparative claim about the firm ("best", "top-rated",',
  '  "#1", "premier", "leading", "most experienced"). RPC 7.1(a) bars claims that cannot',
  "  be factually substantiated.",
  '- NEVER predict or guarantee an outcome ("guaranteed results", "risk-free", "we win").',
  "  Saying that outcomes CANNOT be guaranteed is correct and encouraged.",
  "- Do not state or imply how the firm charges. You may say an initial consultation is",
  "  free; say nothing else about fees.",
].join("\n");
