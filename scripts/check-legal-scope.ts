/**
 * The legal-accuracy scope rule, checked against the sentences it was written
 * for (Diana's 21 September refinements, 2.1).
 *
 *   node scripts/run.mjs scripts/check-legal-scope.ts
 *
 * Read-only, no DB, no model calls. Every case below is either quoted from
 * Diana's document or drawn from the five drafts it reviews, split into the
 * sentences the layer MUST ignore and the ones it MUST look at. The first
 * group is the regression that matters: those are the false positives that
 * produced ~96 findings on a single correct draft.
 *
 * Citation cases are included because scope depends on findCitations, and a
 * citation the parser cannot see is a sentence the layer silently drops.
 */
import { inLegalScope, legalScopeKinds } from "../lib/legal-scope";
import { findCitations } from "../lib/legal-citation";

const SILENT: Array<[string, string]> = [
  ["Gender is a protected class under federal, New York state, and New York City law.", "correct statement Diana quoted"],
  ["Is Gender a Protected Class?", "a heading"],
  ["Title VII protects employees from discrimination.", "names an act, asserts no figure"],
  ["If you believe you were treated unfairly at work, you may have options.", "plain-language prose"],
  ["Our attorneys can help you understand your rights.", "generic firm prose"],
  ["The law generally protects employees from retaliation.", "generic legal statement"],
  ["Every case is different, and the law can be complex.", "generic prose"],
];

const IN_SCOPE: Array<[string, string]> = [
  ["The NYSHRL administrative complaint deadline is one year.", "spelled-out deadline - her most common error"],
  ["The New York State Human Rights Law applies to employers with four or more employees.", "coverage threshold"],
  ["The NYCHRL covers employers with one or more employees.", "coverage threshold"],
  ["You must file a charge with the EEOC within 300 days.", "filing deadline"],
  ["The salary threshold is $1,199.10 per week for the rest of the state.", "wage figure"],
  ["Employees must be paid time and a half for hours over 40.", "overtime rate"],
  ["Employers with 15 or more employees are covered.", "coverage threshold"],
  ["See 29 U.S.C. § 2611(4)(A)(i).", "dotted federal citation"],
  ["New York Labor Law § 198-c is an anti-waiver provision.", "NY citation"],
  ["Roughly 70% of our clients recover unpaid wages.", "unverifiable statistic"],
];

/** Citations the parser must see — dotted forms were silently severed before. */
const CITATIONS: Array<[string, number]> = [
  ["See 29 U.S.C. § 2611(2)(B)(ii).", 1],
  ["29 C.F.R. § 825.100 explains the rule.", 1],
  ["Under N.J.S.A. 10:5-12 the employer is liable.", 1],
  ["NYLL 198-c is an anti-waiver provision.", 1],
  ["Two sentences. The second cites 29 U.S.C. § 207.", 1],
  ["We are located in New York, N.Y. and serve clients statewide.", 0],
];

let failed = 0;
const report = (ok: boolean, line: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${line}`);
};

console.log("-- must produce NOTHING ------------------------------------------");
for (const [s, why] of SILENT) report(!inLegalScope(s), `${why}: "${s.slice(0, 58)}"`);

console.log("\n-- must be examined ---------------------------------------------");
for (const [s, why] of IN_SCOPE) {
  const kinds = legalScopeKinds(s);
  report(kinds.length > 0, `[${(kinds.join(",") || "-").padEnd(8)}] ${why}`);
}

console.log("\n-- citations the parser must see --------------------------------");
for (const [s, want] of CITATIONS) {
  const got = findCitations(s).length;
  report(got === want, `got ${got}, want ${want}: "${s.slice(0, 52)}"`);
}

console.log(
  failed === 0
    ? `\nall ${SILENT.length + IN_SCOPE.length + CITATIONS.length} cases pass`
    : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
