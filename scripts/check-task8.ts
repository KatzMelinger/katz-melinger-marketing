/**
 * Oct 6 spec, Task 8 (gender draft 43fb024e), the code half.
 *
 *   node scripts/run.mjs scripts/check-task8.ts
 *
 * Pure, no DB, no model. Fixture entries mirror the live rows.
 */
import { checkImageFigures, imageFacts } from "../lib/content-analysis";
import type { KbThresholdEntry } from "../lib/legal-knowledge-base";
import { checkValuesAgainst } from "../lib/legal-value-check";
import { toFinding, type ClaimVerdict } from "../lib/legal-verify";

let failed = 0;
const expect = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};

const e = (key: string, label: string, unit: KbThresholdEntry["unit"], currentValue: number, matchKeywords: string[], extra: Partial<KbThresholdEntry> = {}): KbThresholdEntry => ({
  key, label, practiceArea: "employment", jurisdiction: "NY", region: null, unit, currentValue,
  effectiveDate: null, priorValue: null, priorEffectiveDate: null, scheduledValue: null, scheduledEffectiveDate: null,
  matchKeywords, enforcementPath: null, sourceUrl: null, notes: null, ...extra,
});
const KB = [
  e("nyshrl_admin_complaint_deadline", "NYSHRL administrative filing deadline (New York State Division of Human Rights)", "years", 3,
    ["NYSHRL|State Human Rights Law|New York Human Rights Law|Division of Human Rights|NYSDHR|DHR", "deadline|complaint|file|filing|statute of limitations|time limit|within"],
    { effectiveDate: "2024-02-15", priorValue: 1 }),
  e("nyshrl_lawsuit_deadline", "NYSHRL lawsuit deadline (court)", "years", 3,
    ["NYSHRL|State Human Rights Law|New York Human Rights Law", "lawsuit|to sue|court|civil action|CPLR", "file|filing|deadline|statute of limitations|limitations period|within|time limit|bring"]),
  e("nychrl_employer_coverage", "NYCHRL employer coverage (general discrimination)", "employees", 4,
    ["NYCHRL|New York City Human Rights Law|NYC Human Rights Law|New York City law", "employee|employer|cover|applies|apply"]),
  e("nychrl_gbh_employer_coverage", "NYCHRL employer coverage for gender-based harassment", "employees", 1,
    ["NYCHRL|New York City Human Rights Law|NYC Human Rights Law|New York City law", "employee|employer|cover|applies|apply", "gender-based harassment|gender based harassment|gender harassment|sexual harassment"]),
];

// 1. The 43fb024e sentence: the figure belongs to the administrative clause,
// and the correction reads exactly as kb_nysdhr_deadline.reason_label.
const S =
  "Under the New York State Human Rights Law, you have one year to file an administrative complaint with the New York State Division of Human Rights, or three years to file a lawsuit directly in court.";
const f = checkValuesAgainst(S, KB);
expect(f.length === 1, `one correction (got ${f.length})`);
expect(
  f[0]?.title ===
    "NYSHRL administrative filing deadline (New York State Division of Human Rights) is 3 years for claims arising on or after February 15, 2024, not 1 year",
  `reason label (got "${f[0]?.title}")`,
);
expect(f[0]?.fix?.startsWith('Replace "one year" with "3 years') ?? false, `exact fix (got ${f[0]?.fix})`);

// 2. Image specs: the figure is corrected, and the facts reach the prompt.
const img = { type: "infographic", description: "Three tiers: Federal 15+ employees; NYSHRL all employers; NYCHRL: 1+ employee (other claims).", altText: "Chart of employer coverage" };
const fixed = checkImageFigures(img, KB);
expect(!!fixed && !fixed.description.includes("1+ employee") && fixed.description.includes("4 or more employees"),
  `image figure corrected (got ${fixed?.description})`);
expect(checkImageFigures({ ...img, description: "NYCHRL covers employers with 4 or more employees." }, KB)?.description === "NYCHRL covers employers with 4 or more employees.",
  "a correct image spec is untouched");
const facts = imageFacts("The NYCHRL protects workers in New York City.", KB);
expect(facts.includes("NYCHRL employer coverage (general discrimination): 4 or more employees"), `facts for named laws (got ${facts})`);
expect(!facts.includes("NYSHRL"), "no facts for laws the draft does not name");

// 3. The "unclassified" rule is retired: a contradicted claim is a factual mismatch.
const v: ClaimVerdict = {
  claim: { sentence: "Title VII applies to employers with 5 employees under 42 U.S.C. 2000e(b).", index: 0, claimType: "unclassified", jurisdiction: "federal", citations: [], reason: "", autoCheckable: false },
  verdict: "contradicted",
  quote: "fifteen or more employees",
  reason: "",
  sourceUrl: null,
};
const c = toFinding(v, { thresholds: [], kbEntries: [], statutes: [] });
expect(c?.ruleId === "factual_mismatch" && c.claimType === "factual_mismatch", `no unclassified rule (got ${c?.ruleId})`);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
