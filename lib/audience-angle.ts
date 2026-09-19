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
const DEBTOR_ADDRESS_RE =
  /\bfor debtors[:,]|\battention debtors\b|\bif you owe (money|a debt)\b|\bas a debtor,|\bstruggling (with|to pay) (your )?debt\b|\bbeing sued for a debt you owe\b|\bcan'?t pay your bills\b/i;

export function checkAudienceAngle(
  body: string,
  practiceArea: string | null | undefined,
): AudienceAngleHit | null {
  if (!body) return null;
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
