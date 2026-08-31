/**
 * Tests the authority-excerpt selection.
 *
 *   node scripts/run.mjs scripts/check-authority-excerpt.ts
 *
 * These run against the REAL ingested statutes, because the bug this fixes only
 * appears at real statute length: N.J.S.A. 10:5-12 is 43,815 characters and the
 * verifier used to see the first 12,000 of them.
 *
 * No network, no model calls.
 */
import { focusedExcerpt, splitBlocks, claimTerms, quoteRelatesToClaim } from "@/lib/authority-excerpt";
import { lookupCorpus } from "@/lib/nj-statute-corpus";
import { parseCitation } from "@/lib/legal-citation";

let pass = 0, fail = 0;
const t = (n: string, c: boolean) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n); } };

const lad = lookupCorpus(parseCitation("N.J.S.A. 10:5-12")!);
const defs = lookupCorpus(parseCitation("N.J.S.A. 10:5-5")!);

console.log("Term extraction:");
t("drops stopwords and short words", !claimTerms("the employer shall not").includes("shall"));
t("keeps distinctive terms", claimTerms("pregnancy and breastfeeding accommodations").includes("breastfeeding"));

console.log("\nShort authorities are passed through untouched:");
const short = "10:1-1. A short section.\n\nSome text that is well under the budget.";
t("returned verbatim", focusedExcerpt(short, "anything") === short);

if (!lad) {
  console.log("\n  N.J.S.A. 10:5-12 is not in the corpus — ingest it to run the rest.");
} else {
  const text = lad.text;
  console.log(`\nN.J.S.A. 10:5-12 (${text.length.toLocaleString()} chars):`);
  t("is genuinely longer than the old 12,000 cap", text.length > 12_000);
  t("splits into many subsection blocks", splitBlocks(text).length > 10);

  // The bug, stated as a test: something real that sits past the old cutoff.
  const tail = text.slice(12_000);
  const marker = "breastfeeding";
  const inTail = tail.toLowerCase().includes(marker);
  console.log(`  ("${marker}" appears past the old 12,000 cutoff: ${inTail})`);

  const ex = focusedExcerpt(text, "Is it unlawful to refuse to accommodate an employee who is breastfeeding?");
  t("excerpt stays within budget", ex.length <= 12_000 + 200);
  if (inTail) {
    t("REACHES content the old prefix cut off", ex.toLowerCase().includes(marker));
  }
  t("always keeps the opening framing", ex.startsWith("10:5-12."));
  t("marks where text was skipped", ex.includes("[...]"));

  const ex2 = focusedExcerpt(text, "age discrimination in refusing to hire");
  t("a different claim selects a different excerpt", ex2 !== ex);
  t("that excerpt mentions age", ex2.toLowerCase().includes("age"));
}

if (defs) {
  console.log(`\nN.J.S.A. 10:5-5 (${defs.text.length.toLocaleString()} chars):`);
  const ex = focusedExcerpt(defs.text, "Does NJLAD protect sexual orientation?");
  t("excerpt includes the protected-class language", ex.toLowerCase().includes("affectional or sexual orientation"));
}

console.log("\nQuote relevance — the mismatched-evidence case:");
t("an unrelated proviso is rejected",
  !quoteRelatesToClaim(
    "nor shall anything herein contained be construed to bar any private secondary or post-secondary school from using in good faith criteria other than",
    "Under the NJLAD, sexual orientation is not a protected characteristic.",
  ));
t("the correct passage is accepted",
  quoteRelatesToClaim(
    "because of the affectional or sexual orientation of any individual",
    "Under the NJLAD, sexual orientation is not a protected characteristic.",
  ));
t("a claim with no distinctive terms is not blocked", quoteRelatesToClaim("anything at all", "the and for"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
