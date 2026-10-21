/**
 * Diana's regression cases (Oct 20 spec, Task A6): every error found in a
 * manual review, as a sentence or body and the expected result. Runs before
 * every deploy (scripts/regression.ts). When Diana finds a new error, it is
 * added here before the fix is built.
 *
 *   node scripts/run.mjs scripts/check-oct20-regressions.ts
 *
 * Read-only, no DB, no network: traps come from their source files and the
 * knowledge base values from fixtures that mirror the live entries.
 */
import { matchTrap, type KnownTrap, type TrapContext } from "../lib/known-traps";
import { OCT6_TRAPS } from "../lib/known-traps-oct6";
import { findFeeLanguage } from "../lib/fee-language";
import { checkValuesAgainst } from "../lib/legal-value-check";
import type { KbThresholdEntry } from "../lib/legal-knowledge-base";
import { reframeBody } from "../lib/draft-frame";

let failed = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${what}`);
};

const trap = (n: string): KnownTrap => {
  const t = OCT6_TRAPS.find((x) => x.number === n);
  if (!t) throw new Error(`no trap ${n}`);
  return { ...t, id: n, enabled: true };
};
const web: TrapContext = { isWebPage: true };
const harassment: TrapContext = { isWebPage: true, title: "Sexual harassment at work in New York" };
const fires = (n: string, text: string, ctx: TrapContext = web) => matchTrap(trap(n), text, ctx).length > 0;

const t = (o: Partial<KbThresholdEntry> & Pick<KbThresholdEntry, "key" | "label" | "unit" | "currentValue">): KbThresholdEntry =>
  ({ practiceArea: "employment", jurisdiction: "NY", region: null, effectiveDate: null, priorValue: null, priorEffectiveDate: null, matchKeywords: [], enforcementPath: null, sourceUrl: null, notes: null, ...o }) as KbThresholdEntry;
// Mirrors the live knowledge base entries these cases depend on.
const KB: KbThresholdEntry[] = [
  t({ key: "nychrl_employer_coverage", label: "NYCHRL employer coverage (general discrimination)", unit: "employees", currentValue: 4,
      matchKeywords: ["NYCHRL|New York City Human Rights Law|NYC Human Rights Law|New York City law", "employee|employer|cover|applies|apply"] }),
  t({ key: "nyc_commission_deadline", label: "NYC Commission on Human Rights complaint deadline", unit: "years", currentValue: 1,
      matchKeywords: ["NYC Commission|Commission on Human Rights|NYCCHR", "file|complaint|deadline"] }),
  t({ key: "ny_overtime_exempt_threshold_remainder", label: "NY overtime-exempt salary threshold - remainder of state",
      region: "remainder_of_state", unit: "usd_per_week", currentValue: 1199.1, effectiveDate: "2026-01-01" }),
];

console.log("-- employment ------------------------------------------------------");
check(fires("1", "New York and New Jersey courts recognize a public policy exception to at will employment."), "Trap 1: public policy exception in New York (critical)");
check(trap("1").severity === "critical", "Trap 1 is critical");
check(fires("2", "See Sabetay v. Sterling Drug, Inc., 69 N.Y.2d 329 (1987), recognizing a public policy exception in New York."), "Trap 2: Sabetay cited for a New York public policy exception");
check(fires("3", "The violation must create a substantial danger to public health or safety."), "Trap 3: pre 2022 substantial danger requirement");
const oneOrMore = checkValuesAgainst("The NYCHRL covers employers with one or more employees.", KB);
check(oneOrMore.some((f) => /4 or more/.test(f.title)), 'NYCHRL "one or more employees" -> fix to four or more');
check(fires("9", "The New York City Human Rights Law applies to employers with four or more employees.", harassment), 'NYCHRL "four or more" in harassment content -> flag (any size for gender based harassment)');
const commission = checkValuesAgainst("You have three years to file a complaint with the NYC Commission on Human Rights.", KB);
check(commission.some((f) => /1 year/.test(f.title) && /^Replace "three years" with "1 year"/.test(f.fix ?? "")), "NYC Commission three years (no gender based harassment limit) -> fix to 1 year");
check(fires("27", "Many employment attorneys offer free initial consultations.") && findFeeLanguage("Many employment attorneys offer free initial consultations.").length > 0, '"Many employment attorneys offer free initial consultations." -> fee rule');

console.log("\n-- collections -----------------------------------------------------");
check(fires("17", "A restraining notice freezes the debtor's account up to the amount of the judgment."), 'Restraining notice "up to the amount of the judgment" -> fix to twice (CPLR 5222(b))');
check(fires("18", "The New Jersey Special Civil Part hears claims up to $15,000."), "NJ Special Civil Part $15,000 -> fix to $20,000");
check(fires("20", "The FDCPA applies to all collection agencies."), "FDCPA applied to all collection agencies -> fix to consumer debts");

console.log("\n-- frame and wage values -------------------------------------------");
const framed = reframeBody(
  "# Collection Agency Attorney\n\nTarget keywords: collection agency attorney, commercial debt collection lawyer New York\n\nBody text.\n",
  { language: "en", phone: "212-460-0047", offerPhrase: "Free Confidential Case Evaluation", offerPhraseEs: "" },
  { format: "blog", byline: { state: "pending", attorney: "Adam Sackowitz" } },
).body;
check(!framed.includes("Target keywords"), '"Target keywords: collection agency attorney" in a body -> removed');
const current = checkValuesAgainst("## 2026 Salary Thresholds\n\nIn the rest of New York State the threshold is $1,199.10 per week as of 2026.", KB);
check(current.length === 0, "Rest of New York State $1,199.10 per week under a 2026 heading -> Current, no Apply");
// The byline case ("By Nicole Grunfeld, Katz Melinger PLLC" on a Ready draft
// -> fail) is in scripts/check-draft-readiness.ts.

console.log("\nNot yet seeded: the ten jurisdiction snippets from the October 8 Fact Checker spec (that document is needed).");
console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
