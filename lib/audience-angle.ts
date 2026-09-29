/**
 * Audience angle by practice area (spec 1.3, DECIDED — Diana, Sept 18).
 *
 *   - Employment matters: write from the EMPLOYEE angle. Never address
 *     employers, never give employer-side advice, never imply the firm
 *     represents employers.
 *   - Commercial Collections / Judgment Enforcement: write from the CREDITOR
 *     and business angle — the one area the firm represents businesses.
 *
 * The live example that motivated this: a wage-theft LinkedIn post included
 * "For employers: this is a wake-up call to review payroll practices
 * immediately" — a direct address to the wrong audience on an employment
 * topic. This is a narrow, high-confidence pattern check for exactly that
 * failure shape (a direct callout to the audience the firm does NOT
 * represent in that practice area), not a general sentiment/tone classifier
 * — a fuzzy angle-detector would either miss the real cases or false-block
 * legitimate neutral statements like "employers must pay overtime," which is
 * accurate information addressed TO the employee reader, not written FOR an
 * employer reader.
 */

export type AudienceAngleHit = { matched: string };

/** Employment content wrongly addressing employers as the reader. */
const EMPLOYER_ADDRESS_RE =
  /\bfor employers[:,]|\battention employers\b|\bemployers should\b|\bas an employer,|\bif you('re| are) an employer\b|\byour (payroll practices|hr (team|department)|human resources)\b/i;

/** Collections content wrongly addressing the debtor as the reader — the
 *  firm's collections practice represents the creditor/business trying to
 *  collect, never the person or business who owes the debt. */
// The second line of alternatives came from the three blogs in Diana's Sept 28
// audit ("What Debtors Need to Know", "When a Debt Collection Law Firm
// Contacts You", "...Residents Need to Know"), none of which the first line
// caught: they address the debtor as "you" without ever saying "debtor,".
const DEBTOR_ADDRESS_RE = new RegExp(
  [
    /\bfor debtors[:,]|\battention debtors\b|\bif you owe (money|a debt)\b|\bas a debtor,|\bstruggling (with|to pay) (your )?debt\b|\bbeing sued for a debt you owe\b|\bcan'?t pay your bills\b/
      .source,
    /\b(?:debtors|residents|consumers) need to know\b|\b(debt collect(or|ion)( law firm| agency)?|collection (agency|law firm)|law office debt collector)s? (contacts|calls|sues|writes to) you\b|\byour rights (as a (debtor|consumer)|under the (FDCPA|Fair Debt Collection Practices Act))\b|\byou (can|may|should|have the right to) dispute (the|a|your) debt\b|\bhow to dispute (a|the|your) debt\b|\bhow to (respond|stop|deal with) (a )?(debt collect|collection)/
      .source,
  ].join("|"),
  "i",
);

/** Map the stored practice_area (free text in places) to the two angles. */
export function normalizePracticeArea(v: string | null | undefined): "employment" | "collections" | null {
  const t = (v ?? "").toLowerCase();
  if (!t) return null;
  if (/collect|judgment|creditor|debt/.test(t)) return "collections";
  if (/employ|wage|discrimin|harass|retaliat|fmla|termination|severance/.test(t)) return "employment";
  return null;
}

/** Every wrong-audience address in the text (checkAudienceAngle stops at the first). */
export function audienceAngleHits(
  text: string,
  practiceArea: string | null | undefined,
): AudienceAngleHit[] {
  if (!text) return [];
  const area = normalizePracticeArea(practiceArea) ?? practiceArea;
  const re = area === "employment" ? EMPLOYER_ADDRESS_RE : area === "collections" ? DEBTOR_ADDRESS_RE : null;
  if (!re) return [];
  const g = new RegExp(re.source, "gi");
  return [...text.matchAll(g)].map((m) => ({ matched: m[0] }));
}

export function checkAudienceAngle(
  body: string,
  practiceArea: string | null | undefined,
): AudienceAngleHit | null {
  if (!body) return null;
  practiceArea = normalizePracticeArea(practiceArea) ?? practiceArea;
  if (practiceArea === "employment") {
    const m = body.match(EMPLOYER_ADDRESS_RE);
    return m ? { matched: m[0] } : null;
  }
  if (practiceArea === "collections") {
    const m = body.match(DEBTOR_ADDRESS_RE);
    return m ? { matched: m[0] } : null;
  }
  return null;
}
