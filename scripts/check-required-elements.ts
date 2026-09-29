/**
 * applyRequiredDisclaimers: label, CTA, closing disclaimer, results line.
 *
 *   node scripts/run.mjs scripts/check-required-elements.ts
 *
 * Read-only, no DB. Guards the four properties the Sept 28 spec depends on:
 * every element is added, a legacy disclaimer is replaced rather than doubled,
 * the CTA always sits above the disclaimer, and a second call changes nothing.
 */
import {
  applyRequiredDisclaimers,
  GENERAL_LEGAL_DISCLAIMER_TEXT,
  hasDisclaimerLink,
  hasGeneralLegalDisclaimer,
} from "../lib/legal-disclaimers";

const cta = { phone: "212-460-0047", offerPhrase: "Free Confidential Case Evaluation" };
let failed = 0;
function expect(ok: boolean, msg: string) {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

// 1. A bare draft gets everything, in order.
const bare = "# Unpaid Overtime in New York\n\nYou worked the hours.\n\nHere is what the law says.";
const a = applyRequiredDisclaimers(bare, { cta });
expect(a.body.startsWith("*Attorney Advertising*"), "label at top");
expect(hasGeneralLegalDisclaimer(a.body), "current disclaimer present");
expect(hasDisclaimerLink(a.body), "Disclaimer is linked");
const ctaAt = a.body.indexOf("Call today at 212-460-0047 for a Free Confidential Case Evaluation.");
const discAt = a.body.indexOf("This article is for general informational purposes only");
expect(ctaAt > 0 && discAt > ctaAt, "CTA above disclaimer");
expect(a.inserted.join(",") === "label,cta,general_disclaimer", `inserted ${a.inserted.join(",")}`);

// 2. Idempotent.
const b = applyRequiredDisclaimers(a.body, { cta });
expect(b.body === a.body && b.inserted.length === 0, "second call is a no-op");

// 3. A legacy disclaimer is replaced, not doubled, and the CTA goes above it.
const legacy =
  "*Attorney Advertising*\n\nBody text.\n\n*This article provides general information and is not legal advice. Consult with an attorney about your specific situation.*";
const c = applyRequiredDisclaimers(legacy, { cta });
expect(!c.body.includes("provides general information"), "legacy disclaimer removed");
expect(count(c.body, "general informational purposes only") === 1, "exactly one disclaimer");
expect(c.body.indexOf("Call today") < c.body.indexOf("general informational purposes"), "CTA above replaced disclaimer");

// 4. A result mention adds the results line, last.
const result = "Body.\n\nThe firm recovered $250,000 in a settlement for a client.";
const d = applyRequiredDisclaimers(result, { cta });
expect(d.body.trimEnd().endsWith("*Prior results do not guarantee a similar outcome. Results vary depending on your particular facts and legal circumstances.*"), "results line last");

// 5. Without a CTA option, nothing CTA-shaped is added (email/social callers).
const e = applyRequiredDisclaimers(bare);
expect(!e.body.includes("Call today"), "no CTA when not asked");

// 6. The wording is Kenneth's, verbatim.
expect(
  GENERAL_LEGAL_DISCLAIMER_TEXT ===
    "This article is for general informational purposes only, is not legal advice and does not create an attorney client relationship. For more information see our full Disclaimer.",
  "disclaimer wording verbatim",
);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
