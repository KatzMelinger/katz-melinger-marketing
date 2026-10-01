/**
 * Wage figures against the knowledge base (2027 update, 2026-10-01).
 *
 *   node scripts/run.mjs scripts/check-wage-values.ts
 *
 * Pure: fixture entries mirror the live legal_knowledge_base wage rows.
 * Covers the New Jersey change scheduled for 2027 (current $16.48 from
 * 2027-01-01, prior $15.92), New York unchanged for 2027, tipped cash wages
 * no longer read as a wrong minimum wage, and the "Outside New York City"
 * region bug.
 */
import { checkValuesAgainst } from "../lib/legal-value-check";
import type { KbThresholdEntry } from "../lib/legal-knowledge-base";

const e = (
  key: string,
  jurisdiction: KbThresholdEntry["jurisdiction"],
  region: string | null,
  currentValue: number,
  effectiveDate: string,
  priorValue: number | null = null,
): KbThresholdEntry => ({
  key, label: key, practiceArea: "employment", jurisdiction, region, unit: "usd_per_hour",
  currentValue, effectiveDate, priorValue, priorEffectiveDate: null, matchKeywords: [],
  enforcementPath: null, sourceUrl: null, notes: null,
});

const KB: KbThresholdEntry[] = [
  e("ny_min_wage_downstate", "NY", "downstate", 17, "2026-01-01", 16.5),
  e("ny_min_wage_remainder", "NY", "remainder_of_state", 16, "2026-01-01", 15.5),
  e("ny_tipped_food_cash_downstate", "NY", "downstate", 11.35, "2026-01-01"),
  e("ny_tipped_food_credit_downstate", "NY", "downstate", 5.65, "2026-01-01"),
  e("ny_tipped_food_cash_remainder", "NY", "remainder_of_state", 10.7, "2026-01-01"),
  e("ny_home_care_aide_downstate", "NY", "downstate", 20, "2027-01-01"),
  e("ny_overtime_at_min_wage_downstate", "NY", "downstate", 25.5, "2026-01-01", 24.75),
  e("ny_overtime_at_min_wage_remainder", "NY", "remainder_of_state", 24, "2026-01-01", 23.25),
  e("nj_min_wage", "NJ", null, 16.48, "2027-01-01", 15.92),
  e("federal_min_wage", "federal", null, 7.25, "2009-07-24"),
];

const PASS = [
  "The New Jersey minimum wage is $15.92 per hour.",
  "Starting January 1, 2027, the New Jersey minimum wage is $16.48 per hour.",
  "In New York City, the minimum wage is $17.00 per hour in 2027.",
  "Tipped food service workers in New York City must receive a cash wage of at least $11.35 per hour.",
  "Outside New York City, in the rest of the state, the minimum wage is $16.00 per hour.",
  "Outside New York City, Long Island and Westchester, the minimum wage is $16.00 per hour.",
  "The minimum wage is $17.00 per hour in New York City and $16.00 per hour in the rest of the state.",
  "Home care aides in New York City earn at least $20.00 per hour starting in 2027.",
  "The federal minimum wage is $7.25 per hour.",
  "A minimum-wage worker in New York City earns $25.50 per hour for overtime.",
  "In the rest of the state, overtime at the minimum wage is $24.00 per hour.",
];
const FLAG = [
  "In 2026, the New Jersey minimum wage is $16.48 per hour.",
  "The New Jersey minimum wage in 2027 is $15.92 per hour.",
  "In New York City, the minimum wage is $17.50 per hour.",
  "Outside New York City, in the rest of the state, the minimum wage is $17.00 per hour.",
  "As of 2025, the minimum wage in New York City is $17.00 per hour.",
];

let failed = 0;
for (const s of PASS) {
  const f = checkValuesAgainst(s, KB);
  if (f.length) { failed++; console.log(`FAIL should pass: ${s}  -> ${f[0].title}`); }
}
for (const s of FLAG) {
  if (!checkValuesAgainst(s, KB).length) { failed++; console.log(`FAIL should flag: ${s}`); }
}
const total = PASS.length + FLAG.length;
console.log(`${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
