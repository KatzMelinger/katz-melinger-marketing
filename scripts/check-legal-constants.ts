/**
 * The knowledge-base fact check, against the errors Diana's five-draft test
 * found (21 September refinements, 2.2 and 6).
 *
 *   node scripts/run.mjs scripts/check-legal-constants.ts
 *
 * Fixture-driven: the thresholds below mirror what
 * supabase/legal_knowledge_base_constants.sql seeds, so this runs with no DB
 * and still proves the comparison. Every "must flag" case is a sentence
 * quoted from, or built from, her document; every "must stay silent" case is
 * the same fact stated CORRECTLY, which is the half that decides whether the
 * panel is usable.
 */
import { checkValuesAgainst } from "../lib/legal-value-check";
import type { KbThresholdEntry } from "../lib/legal-knowledge-base";

const t = (o: Partial<KbThresholdEntry> & Pick<KbThresholdEntry, "key" | "label" | "unit" | "currentValue">): KbThresholdEntry => ({
  practiceArea: "employment",
  jurisdiction: "NY",
  region: null,
  effectiveDate: null,
  priorValue: null,
  priorEffectiveDate: null,
  matchKeywords: [],
  enforcementPath: null,
  sourceUrl: null,
  notes: null,
  ...o,
} as KbThresholdEntry);

const KB: KbThresholdEntry[] = [
  t({ key: "nyshrl_admin_complaint_deadline", label: "NYSHRL administrative complaint deadline",
      unit: "years", currentValue: 3, effectiveDate: "2024-02-15", priorValue: 1,
      matchKeywords: ["NYSHRL|New York State Human Rights Law|Human Rights Law",
                      "deadline|complaint|file|filing|statute of limitations|time limit"] }),
  t({ key: "nyshrl_employer_coverage", label: "NYSHRL employer coverage",
      unit: "employees", currentValue: 1, effectiveDate: "2020-02-08", priorValue: 4,
      matchKeywords: ["NYSHRL|New York State Human Rights Law|Human Rights Law",
                      "employee|employees|employer|employers|cover|covers|covered|applies|apply"] }),
  t({ key: "nychrl_employer_coverage", label: "NYCHRL employer coverage",
      unit: "employees", currentValue: 4,
      matchKeywords: ["NYCHRL|New York City Human Rights Law",
                      "employee|employees|employer|employers|cover|covers|covered|applies|apply"] }),
  t({ key: "title_vii_employer_coverage", label: "Title VII employer coverage",
      jurisdiction: "federal", unit: "employees", currentValue: 15,
      matchKeywords: ["Title VII", "employee|employees|employer|employers|cover|covers|covered|applies|apply"] }),
  t({ key: "eeoc_charge_deadline_deferral", label: "EEOC charge deadline in a deferral state",
      jurisdiction: "federal", unit: "days", currentValue: 300, priorValue: 180,
      matchKeywords: ["EEOC", "deadline|charge|file|filing|days to|time limit"] }),
  // Money rows guard the pre-existing wage check, which shares this entry
  // point — the constants work above must not have disturbed it.
  t({ key: "ny_min_wage_downstate", label: "NY minimum wage - NYC, Long Island, Westchester",
      region: "downstate", unit: "usd_per_hour", currentValue: 17.0,
      effectiveDate: "2026-01-01", priorValue: 16.5 }),
  t({ key: "ny_overtime_exempt_threshold_remainder", label: "NY overtime-exempt salary threshold - remainder of state",
      region: "remainder_of_state", unit: "usd_per_week", currentValue: 1199.1,
      effectiveDate: "2026-01-01" }),
];

const MUST_FLAG: Array<[string, string]> = [
  ["The New York State Human Rights Law requires you to file within one year.", "her #1 recurring error"],
  ["The NYSHRL administrative complaint deadline is 1 year.", "same error, digits"],
  ["The New York State Human Rights Law applies to employers with four or more employees.", "quid pro quo draft"],
  ["The NYSHRL covers employers with at least 4 employees.", "same error, reworded"],
  ["The NYCHRL covers employers with one or more employees.", "gender draft"],
  ["Title VII applies to employers with 10 or more employees.", "wrong federal coverage"],
  ["You must file a charge with the EEOC within 180 days.", "the 180/300 deferral error"],
  ["In New York, the salary threshold is $1,275.00 per week in the rest of the state.", "wage: wrong figure for the region"],
  ["In New York City the minimum wage is $17.00 per hour as of 2025.", "wage: right figure, wrong year"],
];

const MUST_BE_SILENT: Array<[string, string]> = [
  ["The New York State Human Rights Law requires you to file within three years.", "correct deadline"],
  ["The NYSHRL administrative complaint deadline is 3 years.", "correct, digits"],
  ["The New York State Human Rights Law applies to all employers, regardless of size.", "correct coverage"],
  ["The NYCHRL covers employers with four or more employees.", "correct NYCHRL coverage"],
  ["Title VII applies to employers with 15 or more employees.", "correct federal coverage"],
  ["You must file a charge with the EEOC within 300 days.", "correct deferral deadline"],
  ["Most cases settle within three years of filing.", "a duration with no legal constant behind it"],
  ["Our firm has recovered wages for employees for over 20 years.", "firm prose with a duration"],
  ["In New York, the salary threshold is $1,199.10 per week in the rest of the state.", "wage: correct figure"],
  ["In New York City the minimum wage is $17.00 per hour as of 2026.", "wage: correct figure and year"],
];

let failed = 0;
console.log("-- must be flagged ----------------------------------------------");
for (const [s, why] of MUST_FLAG) {
  const f = checkValuesAgainst(s, KB);
  const ok = f.length > 0;
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${why}`);
  if (ok) console.log(`        -> ${f[0].title}`);
}

console.log("\n-- must stay silent ---------------------------------------------");
for (const [s, why] of MUST_BE_SILENT) {
  const f = checkValuesAgainst(s, KB);
  const ok = f.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${why}${ok ? "" : `  -> wrongly flagged: ${f[0].title}`}`);
}

console.log("\n-- the Apply-fix instruction ------------------------------------");
const sample = checkValuesAgainst("The New York State Human Rights Law requires you to file within one year.", KB)[0];
console.log(`   title : ${sample.title}`);
console.log(`   detail: ${sample.detail}`);
console.log(`   fix   : ${sample.fix}`);

console.log(failed === 0 ? `\nall ${MUST_FLAG.length + MUST_BE_SILENT.length} cases pass` : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
