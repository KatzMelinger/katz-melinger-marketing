/**
 * Diana's Appendix B (Sept 28 spec) against the knowledge-base fact check.
 *
 *   node scripts/run.mjs scripts/check-legal-constants-sept28.ts
 *
 * Fixture-driven, no DB: KB below mirrors, row for row, the thresholds that
 * supabase/legal_knowledge_base_sept28.sql leaves in public.legal_knowledge_base
 * (the 16 rows it updates, the 16 it inserts, and the one it leaves alone).
 * If you change match_keywords in the SQL, change them here too and re-run.
 *
 * Four sections:
 *   1. Diana's own test set from the spec (must flag / must not flag).
 *   2. Cross-talk guards: every deadline row fires only on ITS deadline.
 *   3. The Sept 21 regression cases from scripts/check-legal-constants.ts,
 *      re-run against these fixtures so the new keywords don't break them.
 *   4. Known limitations: printed, not asserted (see the SQL header).
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

// Shared keyword groups -- kept byte-identical to the SQL.
const COVER = "employee|employer|cover|applies|apply";
const NYSHRL = "NYSHRL|State Human Rights Law|New York Human Rights Law";
const NYCHRL = "NYCHRL|New York City Human Rights Law|NYC Human Rights Law|New York City law";
const GBH = "gender-based harassment|gender based harassment|gender harassment|sexual harassment";
const SUIT = "statute of limitations|limitations period|lawsuit|to sue|court|time limit|deadline";
const WAGE_SUIT = SUIT + "|recover|back pay|back wages|look back|lookback";

const KB: KbThresholdEntry[] = [
  // ---- money (match_keywords empty) ----------------------------------------
  t({ key: "ny_min_wage_downstate", label: "NY minimum wage - NYC, Long Island, Westchester",
      region: "downstate", unit: "usd_per_hour", currentValue: 17.0, effectiveDate: "2026-01-01",
      priorValue: 16.5, priorEffectiveDate: "2025-01-01" }),
  t({ key: "ny_min_wage_remainder", label: "NY minimum wage - remainder of state",
      region: "remainder_of_state", unit: "usd_per_hour", currentValue: 16.0, effectiveDate: "2026-01-01",
      priorValue: 15.5, priorEffectiveDate: "2025-01-01" }),
  t({ key: "federal_min_wage", label: "Federal minimum wage", jurisdiction: "federal",
      unit: "usd_per_hour", currentValue: 7.25, effectiveDate: "2009-07-24" }),
  t({ key: "ny_overtime_exempt_threshold_downstate", label: "NY exempt salary threshold (executive/administrative) - NYC, Long Island, Westchester",
      region: "downstate", unit: "usd_per_week", currentValue: 1275.0, effectiveDate: "2026-01-01" }),
  t({ key: "ny_overtime_exempt_threshold_remainder", label: "NY exempt salary threshold (executive/administrative) - remainder of state",
      region: "remainder_of_state", unit: "usd_per_week", currentValue: 1199.1, effectiveDate: "2026-01-01" }),
  t({ key: "nj_min_wage", label: "NJ minimum wage - most employers", jurisdiction: "NJ",
      unit: "usd_per_hour", currentValue: 15.92, effectiveDate: "2026-01-01" }),
  // untouched by the Sept 28 file, present live
  t({ key: "flsa_exempt_salary_threshold", label: "FLSA exempt salary threshold", jurisdiction: "federal",
      unit: "usd_per_week", currentValue: 684.0 }),

  // ---- NYSHRL ----------------------------------------------------------------
  t({ key: "nyshrl_admin_complaint_deadline", label: "NYSHRL Division of Human Rights complaint deadline",
      unit: "years", currentValue: 3, effectiveDate: "2024-02-15", priorValue: 1,
      matchKeywords: [NYSHRL + "|Division of Human Rights|NYSDHR|DHR",
                      "deadline|complaint|file|filing|statute of limitations|time limit|within"] }),
  t({ key: "nyshrl_lawsuit_deadline", label: "NYSHRL lawsuit deadline (court)",
      unit: "years", currentValue: 3,
      matchKeywords: [NYSHRL, "lawsuit|to sue|court|civil action|CPLR",
                      "file|filing|deadline|statute of limitations|limitations period|within|time limit|bring"] }),
  t({ key: "nyshrl_employer_coverage", label: "NYSHRL employer coverage",
      unit: "employees", currentValue: 1, effectiveDate: "2020-02-08", priorValue: 4,
      matchKeywords: [NYSHRL, COVER] }),

  // ---- NYCHRL / NYC Commission on Human Rights -------------------------------
  t({ key: "nychrl_employer_coverage", label: "NYCHRL employer coverage (general discrimination)",
      unit: "employees", currentValue: 4, matchKeywords: [NYCHRL, COVER] }),
  t({ key: "nychrl_gbh_employer_coverage", label: "NYCHRL employer coverage for gender-based harassment",
      unit: "employees", currentValue: 1, matchKeywords: [NYCHRL, COVER, GBH] }),
  t({ key: "nychrl_statute_of_limitations", label: "NYCHRL lawsuit deadline (court)",
      unit: "years", currentValue: 3,
      matchKeywords: [NYCHRL.replace("|New York City law", ""),
                      "statute of limitations|limitations period|deadline|file|filing|time limit|years to|lawsuit|to sue|court"] }),
  t({ key: "nyc_cchr_complaint_deadline", label: "NYC Commission on Human Rights complaint deadline",
      unit: "years", currentValue: 1,
      matchKeywords: ["Commission on Human Rights|CCHR",
                      "file|filing|complaint|deadline|within|time limit|statute of limitations", "year"] }),
  t({ key: "nyc_cchr_gbh_complaint_deadline", label: "NYC Commission on Human Rights complaint deadline - gender-based harassment",
      unit: "years", currentValue: 3,
      matchKeywords: ["Commission on Human Rights|CCHR",
                      "file|filing|complaint|deadline|within|time limit|statute of limitations", "year", GBH] }),

  // ---- EEOC / federal coverage ----------------------------------------------
  t({ key: "eeoc_charge_deadline_deferral", label: "EEOC charge deadline in NY and NJ",
      jurisdiction: "federal", unit: "days", currentValue: 300, priorValue: 180,
      matchKeywords: ["EEOC|Equal Employment Opportunity Commission",
                      "deadline|charge|file|filing|days to|time limit"] }),
  t({ key: "eeoc_right_to_sue_deadline", label: "Deadline to sue after an EEOC right-to-sue notice",
      jurisdiction: "federal", unit: "days", currentValue: 90,
      matchKeywords: ["right to sue|right-to-sue|notice of right",
                      "lawsuit|court|file suit|filing suit|bring suit|civil action|file a complaint in", "day|month"] }),
  t({ key: "title_vii_employer_coverage", label: "Title VII employer coverage", jurisdiction: "federal",
      unit: "employees", currentValue: 15, matchKeywords: ["Title VII", COVER] }),
  t({ key: "ada_employer_coverage", label: "ADA employer coverage", jurisdiction: "federal",
      unit: "employees", currentValue: 15,
      matchKeywords: ["Americans with Disabilities Act|the ADA|(ADA)|ADA's|ADA covers|ADA applies", COVER] }),
  t({ key: "adea_employer_coverage", label: "ADEA employer coverage", jurisdiction: "federal",
      unit: "employees", currentValue: 20,
      matchKeywords: ["ADEA|Age Discrimination in Employment Act", COVER] }),

  // ---- New Jersey LAD --------------------------------------------------------
  t({ key: "nj_dcr_admin_deadline", label: "NJ Division on Civil Rights complaint deadline",
      jurisdiction: "NJ", unit: "days", currentValue: 180,
      matchKeywords: ["DCR|Division on Civil Rights", "deadline|complaint|file|filing|days|time limit"] }),
  t({ key: "njlad_court_statute_of_limitations", label: "NJLAD lawsuit deadline (court)",
      jurisdiction: "NJ", unit: "years", currentValue: 2,
      matchKeywords: ["NJLAD|New Jersey Law Against Discrimination|Law Against Discrimination",
                      "statute of limitations|limitations period|court|lawsuit|to sue|civil action|time limit|years to"] }),
  t({ key: "njlad_employer_coverage", label: "NJLAD employer coverage", jurisdiction: "NJ",
      unit: "employees", currentValue: 1,
      matchKeywords: ["NJLAD|New Jersey Law Against Discrimination|Law Against Discrimination", COVER] }),

  // ---- Wage and hour / leave / retaliation limitations -----------------------
  t({ key: "flsa_statute_of_limitations", label: "FLSA limitations period (non-willful)",
      jurisdiction: "federal", unit: "years", currentValue: 2,
      matchKeywords: ["FLSA|Fair Labor Standards Act", WAGE_SUIT] }),
  t({ key: "flsa_willful_statute_of_limitations", label: "FLSA limitations period (willful violation)",
      jurisdiction: "federal", unit: "years", currentValue: 3,
      matchKeywords: ["FLSA|Fair Labor Standards Act", WAGE_SUIT, "willful"] }),
  t({ key: "nyll_statute_of_limitations", label: "NY Labor Law wage claim limitations period",
      unit: "years", currentValue: 6,
      matchKeywords: ["NYLL|New York Labor Law|NY Labor Law|New York State Labor Law", WAGE_SUIT] }),
  t({ key: "nyll_215_retaliation_limitations", label: "NY Labor Law § 215 retaliation limitations period",
      unit: "years", currentValue: 2,
      matchKeywords: ["§ 215|§215|section 215|Labor Law 215",
                      "retaliat|limitations|lawsuit|to sue|file|filing|deadline|time limit|years to|claim", "year"] }),
  t({ key: "nyll_740_whistleblower_limitations", label: "NY Labor Law § 740 whistleblower limitations period",
      unit: "years", currentValue: 2,
      matchKeywords: ["§ 740|§740|section 740|Labor Law 740|New York whistleblower|NY whistleblower|New York's whistleblower",
                      "retaliat|whistleblow|limitations|lawsuit|to sue|file|filing|deadline|time limit|years to|claim", "year"] }),
  t({ key: "osha_11c_complaint_deadline", label: "OSHA Section 11(c) retaliation complaint deadline",
      jurisdiction: "federal", unit: "days", currentValue: 30,
      matchKeywords: ["OSHA|Occupational Safety|OSH Act|11(c)", "safety|unsafe|hazard|11(c)",
                      "retaliat|complaint|file|filing|deadline|within|report"] }),
  t({ key: "fmla_statute_of_limitations", label: "FMLA limitations period (non-willful)",
      jurisdiction: "federal", unit: "years", currentValue: 2,
      matchKeywords: ["FMLA|Family and Medical Leave Act", SUIT] }),
  t({ key: "fmla_willful_statute_of_limitations", label: "FMLA limitations period (willful violation)",
      jurisdiction: "federal", unit: "years", currentValue: 3,
      matchKeywords: ["FMLA|Family and Medical Leave Act", SUIT, "willful"] }),
  t({ key: "nyc_esst_dcwp_complaint_deadline", label: "NYC safe and sick time DCWP complaint deadline",
      unit: "years", currentValue: 2,
      matchKeywords: ["DCWP|Consumer and Worker Protection", "sick|ESSTA|ESTA",
                      "complaint|file|filing|deadline|within|time limit"] }),
  t({ key: "nj_whl_statute_of_limitations", label: "NJ Wage and Hour Law limitations period",
      jurisdiction: "NJ", unit: "years", currentValue: 6, effectiveDate: "2019-08-06", priorValue: 2,
      matchKeywords: ["New Jersey Wage and Hour Law|NJ Wage and Hour Law|NJWHL|Wage Theft Act", WAGE_SUIT] }),
];

type Case = [sentence: string, why: string, expectKey?: string];

// 1. Diana's test set, verbatim where she gave a sentence. ------------------
const DIANA_FLAG: Case[] = [
  ["You must file a complaint with the New York State Division of Human Rights within one year.", "DHR 1 year -> 3 years", "NYSHRL Division"],
  ["The NYSHRL applies to employers with four or more employees.", "NYSHRL 4+ -> all employers", "NYSHRL employer coverage"],
  ["The NYCHRL applies to employers with one or more employees.", "NYCHRL 1+ -> 4 (discrimination)", "NYCHRL employer coverage (general"],
  ["The NYCHRL applies to employers with one or more employees for discrimination claims.", "same, with the discrimination context", "NYCHRL employer coverage (general"],
];
const DIANA_SILENT: Case[] = [
  ["New Jersey employees may file with the New Jersey Division on Civil Rights within 180 days or file directly in court within two years.", "NJ DCR 180 days + court 2 years"],
  ["The New Jersey Law Against Discrimination (NJLAD) applies to employers with one or more employees.", "NJLAD all employers"],
  ["The NYCHRL applies to employers with four or more employees.", "NYCHRL 4+"],
  ["The ADEA applies to employers with 20 or more employees.", "ADEA 20+"],
  ["You must file a charge with the EEOC within 300 days.", "EEOC 300 days"],
  ["The minimum wage in New Jersey is $15.92 per hour.", "NJ minimum wage"],
];

// 2. Cross-talk: each deadline answers only to its own row. -----------------
const CROSS_FLAG: Case[] = [
  ["You must file a charge with the EEOC within 180 days.", "EEOC 180 -> 300", "EEOC charge"],
  ["File with the New Jersey Division on Civil Rights within 300 days.", "DCR 300 -> 180", "Division on Civil Rights"],
  ["Under the NJLAD, you have one year to file a lawsuit in court.", "NJLAD court 1 -> 2", "NJLAD lawsuit"],
  ["You may file with the NYC Commission on Human Rights within three years.", "CCHR general 3 -> 1", "NYC Commission on Human Rights complaint deadline"],
  ["Gender-based harassment complaints can be filed with the NYC Commission on Human Rights within one year.", "CCHR GBH 1 -> 3", "gender-based harassment"],
  ["For gender-based harassment, the NYCHRL covers employers with four or more employees.", "NYCHRL GBH 4+ -> all", "gender-based harassment"],
  ["The NYSHRL gives you one year to file a lawsuit in court.", "NYSHRL court 1 -> 3", "NYSHRL"],
  ["After you receive a right-to-sue notice, you have 60 days to file a lawsuit in court.", "right-to-sue 60 -> 90", "right-to-sue"],
  ["The FLSA statute of limitations is one year.", "FLSA 1 -> 2", "FLSA limitations period (non-willful)"],
  ["For willful violations, the FLSA statute of limitations is two years.", "FLSA willful 2 -> 3", "willful"],
  ["The New York Labor Law lets you recover three years of unpaid wages.", "NYLL 3 -> 6", "NY Labor Law wage"],
  ["A claim under Labor Law § 215 for retaliation must be brought within six years.", "215: 6 -> 2", "215"],
  ["A § 740 whistleblower lawsuit must be filed within one year.", "740: 1 -> 2", "740"],
  ["An OSHA safety retaliation complaint must be filed within 60 days.", "OSHA 11(c) 60 -> 30", "11(c)"],
  ["The FMLA statute of limitations is one year.", "FMLA 1 -> 2", "FMLA limitations period (non-willful)"],
  ["You can file a sick leave complaint with DCWP within one year.", "DCWP 1 -> 2", "DCWP"],
  ["The New Jersey Wage and Hour Law statute of limitations is two years.", "NJWHL 2 -> 6 (pre-2019 figure)", "NJ Wage and Hour"],
  ["The minimum wage in New Jersey is $15.49 per hour.", "NJ stale 2025 figure", "NJ minimum wage"],
  ["In the rest of the state the New York minimum wage is $15.50 per hour as of 2026.", "NY upstate stale figure dated 2026", "superseded"],
];
const CROSS_SILENT: Case[] = [
  ["File with the New York State Division of Human Rights within three years.", "DHR correct"],
  ["The NYSHRL gives you three years to file a lawsuit in court.", "NYSHRL court correct"],
  ["The NYSHRL applies to all employers, regardless of size.", "NYSHRL coverage correct"],
  ["You may file with the NYC Commission on Human Rights within one year.", "CCHR general correct"],
  ["Gender-based harassment complaints can be filed with the NYC Commission on Human Rights within three years.", "CCHR GBH correct"],
  ["Under the NYCHRL, gender-based harassment protections apply to all employers regardless of size.", "NYCHRL GBH coverage correct"],
  ["Under the NYCHRL, you have three years to file a lawsuit in court.", "NYCHRL court correct"],
  ["After you receive a right-to-sue notice, you have 90 days to file a lawsuit in court.", "right-to-sue correct"],
  ["You can request a right-to-sue letter from the EEOC after 180 days.", "EEOC 180-day early notice is not the charge deadline"],
  ["The FLSA statute of limitations is two years.", "FLSA correct"],
  ["For willful violations, the FLSA statute of limitations is three years.", "FLSA willful correct"],
  ["The New York Labor Law lets you recover six years of unpaid wages.", "NYLL correct"],
  ["A claim under New York Labor Law § 215 for retaliation must be brought within two years.", "215 correct, not NYLL 6"],
  ["A New York Labor Law § 740 whistleblower lawsuit must be filed within two years.", "740 correct, not NYLL 6"],
  ["A CEPA whistleblower lawsuit in New Jersey must be filed within one year.", "CEPA is not § 740"],
  ["An OSHA safety retaliation complaint must be filed within 30 days.", "OSHA 11(c) correct"],
  ["A Sarbanes-Oxley complaint is filed with OSHA within 180 days.", "SOX via OSHA is not 11(c)"],
  ["To be eligible for FMLA leave you must have worked for the employer for at least one year.", "FMLA eligibility is not the limitations period"],
  ["For willful violations, the FMLA statute of limitations is three years.", "FMLA willful correct"],
  ["You can file a sick leave complaint with DCWP within two years.", "DCWP correct"],
  ["Since the Wage Theft Act, the New Jersey Wage and Hour Law statute of limitations is six years.", "NJWHL correct"],
  ["The federal minimum wage is $7.25 per hour.", "federal minimum wage correct"],
  ["In New York City the minimum wage is $17.00 per hour as of 2026.", "NY downstate correct"],
  ["In the rest of the state the New York minimum wage is $16.00 per hour.", "NY upstate correct"],
  ["In New York, the exempt salary threshold is $1,275.00 per week in New York City.", "NY exempt downstate correct"],
  ["Title VII applies to employers with 15 or more employees.", "Title VII correct"],
  ["The ADA applies to employers with 15 or more employees.", "ADA correct"],
  ["Our team has helped Canada-based employers for 20 years and employees with 12 years of service.", "ADA substring 'Canada' does not match"],
];

// 3. Sept 21 regression (scripts/check-legal-constants.ts), same sentences. --
const REG_FLAG: Case[] = [
  ["The New York State Human Rights Law requires you to file within one year.", "Sept21: NYSHRL 1 year"],
  ["The NYSHRL administrative complaint deadline is 1 year.", "Sept21: digits"],
  ["The New York State Human Rights Law applies to employers with four or more employees.", "Sept21: NYSHRL 4+"],
  ["The NYSHRL covers employers with at least 4 employees.", "Sept21: reworded"],
  ["The NYCHRL covers employers with one or more employees.", "Sept21: NYCHRL 1+"],
  ["Title VII applies to employers with 10 or more employees.", "Sept21: Title VII 10"],
  ["You must file a charge with the EEOC within 180 days.", "Sept21: EEOC 180"],
  ["In New York, the salary threshold is $1,275.00 per week in the rest of the state.", "Sept21: wage region"],
  ["In New York City the minimum wage is $17.00 per hour as of 2025.", "Sept21: wage year"],
];
const REG_SILENT: Case[] = [
  ["The New York State Human Rights Law requires you to file within three years.", "Sept21: correct deadline"],
  ["The NYSHRL administrative complaint deadline is 3 years.", "Sept21: correct, digits"],
  ["The New York State Human Rights Law applies to all employers, regardless of size.", "Sept21: correct coverage"],
  ["The NYCHRL covers employers with four or more employees.", "Sept21: NYCHRL 4+"],
  ["Title VII applies to employers with 15 or more employees.", "Sept21: Title VII 15"],
  ["You must file a charge with the EEOC within 300 days.", "Sept21: EEOC 300"],
  ["Most cases settle within three years of filing.", "Sept21: unrelated duration"],
  ["Our firm has recovered wages for employees for over 20 years.", "Sept21: firm prose"],
  ["In New York, the salary threshold is $1,199.10 per week in the rest of the state.", "Sept21: wage correct"],
  ["In New York City the minimum wage is $17.00 per hour as of 2026.", "Sept21: wage + year correct"],
];

// 4. Known limitations: one sentence, two correct values for sibling rows. ---
const KNOWN_LIMITS: Case[] = [
  ["The FLSA statute of limitations is two years, or three years for willful violations.", "both FLSA values in one sentence"],
  ["The NYCHRL covers employers with four or more employees, and all employers for gender-based harassment.", "both NYCHRL coverage values"],
  ["File with the EEOC within 300 days or with the New Jersey Division on Civil Rights within 180 days.", "EEOC + DCR in one sentence"],
  ["The FLSA allows you to recover two years of back wages, while the New York Labor Law allows six years.", "FLSA + NYLL in one sentence"],
];

let failed = 0;
function run(title: string, cases: Case[], mustFlag: boolean) {
  console.log(`\n-- ${title} ${"-".repeat(Math.max(0, 66 - title.length))}`);
  for (const [s, why, expect] of cases) {
    const f = checkValuesAgainst(s, KB);
    let ok = mustFlag ? f.length > 0 : f.length === 0;
    if (ok && mustFlag && expect && !f.some((x) => x.title.includes(expect))) ok = false;
    if (!ok) failed++;
    const detail = f.length ? `  -> ${f.map((x) => x.title).join(" | ")}` : "";
    console.log(`${ok ? "pass" : "FAIL"}  ${why}${mustFlag || !ok ? detail : ""}`);
  }
}

run("Diana Appendix B: must flag", DIANA_FLAG, true);
run("Diana Appendix B: must NOT flag", DIANA_SILENT, false);
run("cross-talk: must flag", CROSS_FLAG, true);
run("cross-talk: must NOT flag", CROSS_SILENT, false);
run("Sept 21 regression: must flag", REG_FLAG, true);
run("Sept 21 regression: must NOT flag", REG_SILENT, false);

console.log("\n-- known limitations (informational, not asserted) ------------------");
for (const [s, why] of KNOWN_LIMITS) {
  const f = checkValuesAgainst(s, KB);
  console.log(`info  ${why}: ${f.length ? `flags -> ${f.map((x) => x.title).join(" | ")}` : "silent"}`);
}

const total = DIANA_FLAG.length + DIANA_SILENT.length + CROSS_FLAG.length + CROSS_SILENT.length + REG_FLAG.length + REG_SILENT.length;
console.log(failed === 0 ? `\nall ${total} cases pass` : `\n${failed} of ${total} FAILED`);
process.exit(failed === 0 ? 0 : 1);
