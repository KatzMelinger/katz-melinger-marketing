/**
 * Deciding which legal claims a machine may check, and which need an attorney.
 *
 * Diana's §2, and the single most consequential piece of the legal layer. Get
 * this wrong toward "auto-check" and the system produces confident wrong
 * answers about the law — which is worse than the green scoreboard it replaced,
 * because a wrong verdict carries more authority than a missing one.
 *
 * THE RULE
 *   Auto-check ONLY a single lookup-able fact an authority states directly:
 *     - a number   (deadline, filing window, dollar amount, percentage, section)
 *     - a date     (effective date, amendment date)
 *     - a citation (does the section exist and say what the draft claims)
 *   Everything else goes to a human: conclusions, interpretations, NEGATIVE
 *   statements, firm claims, and anything that cannot be confidently classified.
 *
 * WHY THE GUARDS ARE DETERMINISTIC
 *
 * A model does the classifying, because deciding whether a sentence is a
 * conclusion needs language understanding. But a model asked "is this
 * checkable?" is systematically biased toward yes — being helpful looks like
 * answering. So the categories that MUST NOT be auto-checked are detected by
 * pattern first, and a deterministic detection OVERRIDES the model. The model
 * can move a claim toward human review; it can never move one away from it.
 *
 * Negative statements matter most here. "The FMLA is not enforced by the EEOC"
 * is true, important, and unverifiable by any lookup — no authority page states
 * what a statute does not do. Retrieval will find nothing and, without this
 * guard, "nothing found" reads as "no problem found".
 *
 * The mixed case is Diana's too: "passing the auto-check means the fact is
 * right, not that the sentence's conclusion is." A sentence carrying a number
 * AND an interpretation goes to a human, even though the number is checkable.
 */

import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "./anthropic";
import { findFeeLanguage } from "./fee-language";
import { findFirmFactClaims } from "./firm-facts";
import { findCitations, type ParsedCitation } from "./legal-citation";
import type { LegalClaimType, LegalJurisdiction } from "./content-findings";

export type LegalClaim = {
  /** The sentence as written. */
  sentence: string;
  /** Character offset in the body. */
  index: number;
  claimType: LegalClaimType;
  jurisdiction: LegalJurisdiction | null;
  /** Citations found in this sentence, if any. */
  citations: ParsedCitation[];
  /** Why it was classified this way — shown to the reviewer. */
  reason: string;
  /** True only when a lookup can settle it. */
  autoCheckable: boolean;
};

// ---------------------------------------------------------------------------
// Deterministic guards. These override the model, never the reverse.
// ---------------------------------------------------------------------------

/**
 * Negative legal statements — "X does not apply", "the FMLA is not enforced by".
 *
 * Deliberately broad. A false positive costs an unnecessary attorney review; a
 * false negative sends an unverifiable claim to a lookup that will find nothing
 * and report no problem. Those costs are not symmetric.
 */
const NEGATIVE_STATEMENT =
  /\b(?:is|are|was|were|does|do|did|has|have|can|could|will|would|shall|may|must)\s+(?:not|n['’]t)\b|\bcannot\b|\bnever\b|\bno longer\b|\bneither\b|\bnor\b|\bdoes not apply\b|\bnot (?:covered|required|eligible|enforced|governed|protected|available)\b|\bexempt from\b|\bnot a\b/i;

/** Language that marks a conclusion rather than a retrievable fact. */
const INTERPRETIVE =
  /\b(?:means|meaning|constitutes|amounts to|qualifies as|counts as|is considered|treated as|generally|typically|usually|likely|may be able|courts have|has been held|interpreted|depends on|in most cases|as a practical matter)\b/i;

/** A lookup-able fact: a number, a money amount, a period, or a date. */
const FACTUAL_SIGNAL =
  /\b\d{1,4}\s*(?:days?|months?|years?|weeks?|hours?)\b|\$\s?[\d,]+(?:\.\d{2})?\b|\b\d{1,3}\s*(?:%|percent)\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b|\b\d{4}\s+amendments?\b|\b(?:effective|amended|enacted)\s+(?:on\s+)?\w+\s+\d/i;

/** Jurisdiction signals, checked most specific first. */
function detectJurisdiction(sentence: string): LegalJurisdiction | null {
  if (/\bNew Jersey\b|\bNJ\b|\bNJDOL\b|\bNJLAD\b|\bN\.J\.S\.A\b/i.test(sentence)) return "NJ";
  if (/\bNew York\b|\bNY\b|\bNYC\b|\bNYLL\b|\bNYSHRL\b|\bNYCHRL\b|\bCPLR\b/i.test(sentence)) return "NY";
  if (/\bFMLA\b|\bFLSA\b|\bTitle VII\b|\bEEOC\b|\bADA\b|\bADEA\b|\bfederal\b|\bU\.?S\.?C\b|\bC\.?F\.?R\b/i.test(sentence)) {
    return "federal";
  }
  return null;
}

/** Does this sentence make any legal assertion worth examining at all? */
/**
 * Statutes and agencies named by acronym.
 *
 * Not decoration. "The FMLA is not enforced by the EEOC" contains no word from
 * the general list — not law, not statute, not employee — so without this the
 * single trap that started this whole review was dropped before it ever
 * reached the classifier.
 */
const STATUTE_ACRONYM =
  /\b(?:FMLA|FLSA|EEOC|NYLL|NYSHRL|NYCHRL|NJLAD|CPLR|ADA|ADEA|WARN|COBRA|ERISA|OSHA|DOL|NYSDOL|NJDOL|DHR|Title\s+VII|GENDA|SONDA)\b/i;

/** Does this sentence make a legal assertion worth examining? */
function looksLegal(sentence: string): boolean {
  return (
    // A sentence carrying a citation is legally relevant by definition.
    // Without this, "See 29 CFR 825.100 for the details." is dropped — it
    // contains no legal vocabulary at all, only the citation itself, which
    // is precisely the sentence a lookup could settle.
    findCitations(sentence).length > 0 ||
    STATUTE_ACRONYM.test(sentence) ||
    /\b(?:law|laws|statute|section|\u00a7|act\b|regulation|rule|court|claim|file|filing|deadline|entitled|require[sd]?|prohibit|protect|liable|damages|penalty|employer|employee|charge|rights?|leave|wages?)\b/i.test(
      sentence,
    ) ||
    FACTUAL_SIGNAL.test(sentence)
  );
}

/**
 * Split into sentences without cutting citations in half.
 *
 * A naive split on "." turns "29 CFR 825.100" into "29 CFR 825" and ".100 for
 * the details" — the citation is destroyed and the claim it supported becomes
 * uncheckable. Splitting only where terminal punctuation is followed by
 * whitespace and a capital keeps decimals and section numbers intact.
 */
function splitSentences(body: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  let offset = 0;
  // Built via RegExp so the escapes are unambiguous: split on terminal
  // punctuation followed by space + a capital, or on a blank line.
  const boundary = new RegExp("(?<=[.!?])[ \t]+(?=[A-Z0-9\"\u0027(\u00a7])|\n+");
  for (const part of body.split(boundary)) {
    const text = (part ?? "").trim();
    const at = body.indexOf(text, offset);
    if (text.length > 25) out.push({ text, index: at >= 0 ? at : offset });
    offset = (at >= 0 ? at : offset) + text.length;
  }
  return out;
}

/**
 * Classify one sentence without a model.
 *
 * Returns a claim type when the answer is unambiguous, or null when the model
 * should decide. Order matters: the categories that must never be auto-checked
 * are tested before anything else.
 */
export function classifyDeterministic(sentence: string): {
  claimType: LegalClaimType;
  reason: string;
} | null {
  // A statement about the firm is never a question about the law.
  if (findFeeLanguage(sentence).some((h) => h.subject === "firm")) {
    return { claimType: "firm_claim", reason: "States how the firm charges." };
  }
  if (findFirmFactClaims(sentence).length > 0) {
    return { claimType: "firm_claim", reason: "A claim about the firm itself, which no authority can confirm." };
  }
  // A negative cannot be confirmed by retrieval, whatever else it contains.
  if (NEGATIVE_STATEMENT.test(sentence)) {
    return {
      claimType: "negative_statement",
      reason:
        "States what the law does NOT do. No authority page asserts a negative, so no lookup can confirm it.",
    };
  }
  // Diana's mixed rule: a number inside a conclusion is still a conclusion.
  if (INTERPRETIVE.test(sentence)) {
    return {
      claimType: "interpretation",
      reason: FACTUAL_SIGNAL.test(sentence)
        ? "Mixes a checkable figure with an interpretation — verifying the figure would not verify the conclusion."
        : "Interprets what the law means or how it applies.",
    };
  }
  return null;
}

const SYSTEM = `You classify legal claims in law-firm marketing content so a system knows which may be verified automatically and which need an attorney.

Return ONE classification per claim, from exactly these:

- "factual_mismatch": a SINGLE lookup-able fact an authority states directly — a number (deadline, filing window, dollar amount, percentage), a date (effective or amendment date), or a citation whose content can be checked. Nothing else in the sentence requires judgment.
- "interpretation": what the law means, whether it applies, how it is enforced, or any conclusion drawn from it.
- "negative_statement": says what the law does NOT do, does not cover, or does not require.
- "firm_claim": a statement about the law firm itself.
- "unclassified": you are not confident. USE THIS FREELY.

Rules you must follow:
1. If a sentence mixes a checkable fact with an interpretation, it is "interpretation", not "factual_mismatch". Verifying the number would not verify the conclusion.
2. Anything you are less than confident about is "unclassified". An unnecessary attorney review costs a minute; a wrong statement of law published on a law firm's site costs a great deal more.
3. "factual_mismatch" is the ONLY type that will be auto-checked. Choose it only when a single authoritative source would settle the sentence outright.

Return JSON only: {"claims":[{"index":<number>,"type":"<type>","reason":"<one short sentence>"}]}`;

/**
 * Classify the sentences a deterministic pass could not settle.
 *
 * Failure is safe by construction: if the model call fails or returns something
 * unparseable, every claim comes back `unclassified`, which routes to a human.
 * The layer degrades toward more review, never toward less.
 */
async function classifyWithModel(
  sentences: { text: string; index: number }[],
): Promise<Map<number, { claimType: LegalClaimType; reason: string }>> {
  const out = new Map<number, { claimType: LegalClaimType; reason: string }>();
  if (sentences.length === 0) return out;

  const listed = sentences.map((s, i) => `${i}. ${s.text}`).join("\n");
  try {
    const res = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Classify each claim:\n\n${listed}` }],
    });
    const text = res.content[0]?.type === "text" ? res.content[0].text : "";
    const parsed = extractJSON<{
      claims: { index: number; type: string; reason: string }[];
    }>(text);
    const valid: LegalClaimType[] = [
      "factual_mismatch",
      "interpretation",
      "negative_statement",
      "firm_claim",
      "unclassified",
    ];
    for (const c of parsed?.claims ?? []) {
      const s = sentences[c.index];
      if (!s) continue;
      const type = valid.includes(c.type as LegalClaimType)
        ? (c.type as LegalClaimType)
        : "unclassified";
      out.set(s.index, { claimType: type, reason: c.reason || "Classified by review." });
    }
  } catch (e) {
    console.warn("[legal-classifier] model classification failed:", e);
  }

  // Anything the model did not return is unclassified, not absent.
  for (const s of sentences) {
    if (!out.has(s.index)) {
      out.set(s.index, {
        claimType: "unclassified",
        reason: "Could not be classified confidently — routed to an attorney.",
      });
    }
  }
  return out;
}

/**
 * Every legal claim in a draft, classified.
 *
 * `autoCheckable` is computed here and nowhere else: a claim is checkable only
 * if it is a factual_mismatch AND carries a citation a lookup can address. A
 * factual claim with no retrievable citation is still a claim for a person —
 * there is nothing to check it against.
 */
export async function classifyLegalClaims(body: string): Promise<LegalClaim[]> {
  if (!body?.trim()) return [];

  // A firm claim ("Katz Melinger works on contingency") often carries no legal
  // vocabulary at all, so it must bypass the relevance filter or it is dropped
  // before anything can classify it.
  const sentences = splitSentences(body).filter(
    (s) => looksLegal(s.text) || classifyDeterministic(s.text)?.claimType === "firm_claim",
  );
  const claims: LegalClaim[] = [];
  const needModel: { text: string; index: number }[] = [];
  const deterministic = new Map<number, { claimType: LegalClaimType; reason: string }>();

  for (const s of sentences) {
    const d = classifyDeterministic(s.text);
    if (d) deterministic.set(s.index, d);
    else needModel.push(s);
  }

  const modelled = await classifyWithModel(needModel);

  for (const s of sentences) {
    const verdict = deterministic.get(s.index) ?? modelled.get(s.index);
    if (!verdict) continue;
    const citations = findCitations(s.text);
    claims.push({
      sentence: s.text,
      index: s.index,
      claimType: verdict.claimType,
      jurisdiction: detectJurisdiction(s.text),
      citations,
      reason: verdict.reason,
      // Both conditions, deliberately. A factual claim with nothing to check it
      // against is not checkable, however factual it is.
      autoCheckable: verdict.claimType === "factual_mismatch" && citations.length > 0,
    });
  }

  return claims;
}
