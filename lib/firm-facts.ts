/**
 * Statements about the FIRM — the claims no source-checker can verify.
 *
 * Diana's §7 list (2026-08-25). Her framing matters: these are "statements about
 * the firm (not about the law) that a source-checker will never catch, so the
 * system should always flag them for review". Two of the seven are flat bans;
 * the rest are claims that need a human to look, not a machine to adjudicate.
 *
 * That split is the design:
 *
 *   BAN (critical, blocks)   — fee arrangements (lib/fee-language.ts) and
 *                              outcome guarantees. Closed sets of phrasings,
 *                              absolute rules, so a pattern decides.
 *   FLAG (important, routes) — the firm's side, licensure, practice areas, and
 *                              name. A pattern can spot the CANDIDATE claim; it
 *                              cannot judge whether the sentence is right. So
 *                              these raise a finding for review rather than
 *                              failing the draft.
 *
 * NOT implemented, deliberately: geographic reach. "Serving the five boroughs,
 * Westchester, Long Island, and northern New Jersey" cannot be checked by
 * pattern without flagging every ordinary mention of a place name — and a rule
 * that fires on "New York" in New York employment content is a rule that gets
 * switched off. It belongs in the human-review bucket §2 already defines.
 *
 * Pure module: no IO, no model.
 */

export type FirmFactSeverity = "ban" | "flag";

export type FirmFactHit = {
  rule: string;
  severity: FirmFactSeverity;
  match: string;
  sentence: string;
  index: number;
  /** What is wrong, or what a reviewer should confirm. */
  reason: string;
};

type FirmFactRule = {
  rule: string;
  severity: FirmFactSeverity;
  re: RegExp;
  reason: string;
  /** Spans matching any of these are not hits. */
  allow?: RegExp[];
};

/** States the firm is NOT licensed in, for the licensure check. */
const OTHER_STATES =
  "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Mexico|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|Connecticut";

/** Work the firm does not do. Offering these is a factual error about the firm. */
const OFF_PRACTICE =
  "personal injury|car accident|criminal defen[cs]e|DUI|DWI|immigration|family law|divorce|child custody|bankruptcy|estate planning|probate|real estate closing|medical malpractice|patent|trademark prosecution";

const RULES: FirmFactRule[] = [
  {
    rule: "Outcome guarantee or superlative",
    severity: "ban",
    re: /\b(?:maximum compensation|guarantee(?:d|s)?\s+(?:a\s+)?(?:result|recovery|outcome|win)|we\s+will\s+win|aggressive representation|best\s+(?:employment\s+)?(?:lawyer|attorney|law firm)|#\s*1\s+(?:lawyer|attorney|law firm)|top[-\s]rated)\b/gi,
    reason:
      "Attorney-advertising rules prohibit outcome guarantees and superlatives that cannot be substantiated.",
  },
  {
    rule: "Firm represents employers",
    severity: "flag",
    // Tight on purpose: content ABOUT employers is the firm's whole subject
    // matter ("your employer must pay overtime"), so only a claim that the FIRM
    // acts for them counts.
    re: /\b(?:we|our\s+(?:firm|attorneys|lawyers)|the\s+firm|Katz\s+Melinger)\s+(?:also\s+)?(?:represent|represents|defend|defends|advise|advises|counsel|counsels)\s+(?:employers|businesses|companies|management)\b|\bour\s+employer\s+clients\b|\bemployer[-\s]side\s+(?:representation|clients?)\b/gi,
    reason:
      "The firm acts for employees only on employment matters, and never for employers. Confirm this sentence is not offering employer-side representation.",
  },
  {
    rule: "Licensure outside NY and NJ",
    severity: "flag",
    re: new RegExp(
      String.raw`\b(?:licensed|admitted|barred|practice|practicing)\s+(?:to\s+practice\s+)?in\s+(?:${OTHER_STATES})\b`,
      "gi",
    ),
    reason:
      "The firm is licensed in New York and New Jersey only. Confirm this does not claim practice rights elsewhere.",
  },
  {
    rule: "Service outside the firm's practice areas",
    severity: "flag",
    re: new RegExp(
      String.raw`\b(?:we|our\s+(?:firm|attorneys|lawyers)|the\s+firm|Katz\s+Melinger)\s+(?:also\s+)?(?:handle|handles|offer|offers|practice|practices|represent\s+clients\s+in)\s+(?:[\w\s,]{0,30}?)(?:${OFF_PRACTICE})\b`,
      "gi",
    ),
    reason:
      "The firm practices employment law and commercial collections / judgment enforcement only. Confirm this does not offer work the firm does not do.",
  },
  {
    rule: "Firm name or domain misspelled",
    severity: "flag",
    // The correct forms are "Katz Melinger PLLC" and katzmelinger.com.
    // Three false positives found by scanning the real library, all of which
    // flagged CORRECT content:
    //   - \s+ spans newlines, so "## Why Katz Melinger\n\nKatz Melinger PLLC…"
    //     matched the reversed-order pattern across a heading boundary. That
    //     shape is a section heading followed by a paragraph and it accounted
    //     for 31 of 32 hits. Reversed order is only wrong on ONE line.
    //   - case-insensitivity made the concatenated form match the "katzmelinger"
    //     inside the correct domain katzmelinger.com.
    //   - "#KatzMelinger" is a hashtag, where running words together is the
    //     convention, not a misspelling.
    re: /\bKatz[-]Melinger\b|(?<!#)\bKatzMelinger\b(?!\.\w)|\bKatz[ \t]+Mellinger\b|\bMelinger[ \t]+Katz\b|\bkatz[-_]melinger\.com\b|\bkatzmelinger\.(?:net|org|law)\b/gi,
    reason:
      'The firm name is "Katz Melinger PLLC" and the website is katzmelinger.com. Correct the spelling.',
  },
];

function sentenceAround(body: string, index: number): string {
  const start = body.lastIndexOf(".", index);
  const nextStop = body.indexOf(".", index);
  const from = start === -1 ? Math.max(0, index - 140) : start + 1;
  const to = nextStop === -1 ? Math.min(body.length, index + 140) : nextStop + 1;
  return body.slice(from, to).replace(/\s+/g, " ").trim();
}

/** Every firm-fact claim in this text worth a reviewer's attention. */
export function findFirmFactClaims(body: string): FirmFactHit[] {
  if (!body) return [];
  const hits: FirmFactHit[] = [];
  const claimed = new Set<number>();

  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (const m of body.matchAll(r.re)) {
      const index = m.index ?? 0;
      if (claimed.has(index)) continue;
      if (r.allow?.some((a) => { a.lastIndex = 0; return a.test(m[0]); })) continue;
      claimed.add(index);
      hits.push({
        rule: r.rule,
        severity: r.severity,
        match: m[0],
        sentence: sentenceAround(body, index),
        index,
        reason: r.reason,
      });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** The firm-fact rules as prose, for the compliance prompt. */
export const FIRM_FACTS_RULE = [
  "FIRM FACTS (statements about Katz Melinger itself — flag any that appear):",
  "- The firm represents EMPLOYEES only on employment matters, never employers.",
  "- Licensed in New York and New Jersey only.",
  "- Practice areas are employment law and commercial collections / judgment enforcement only.",
  '- The firm name is "Katz Melinger PLLC"; the website is katzmelinger.com.',
  "- No outcome guarantees, no superlatives, no claims that cannot be substantiated.",
].join("\n");
