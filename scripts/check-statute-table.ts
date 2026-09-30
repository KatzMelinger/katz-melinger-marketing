/**
 * The statute-subject check (Sept 28 spec, section 3), against the sentences
 * from the audit.
 *
 *   node scripts/run.mjs scripts/check-statute-table.ts
 *
 * Read-only, no DB: runs the pure matcher over the table as written in
 * lib/legal-statute-table.ts. MUST_FLAG are the audit's real errors; MUST_PASS
 * are correct citations that must stay silent ("correctly cited sections pass
 * silently" is half of section 3's done-when).
 */
import { checkStatutes, STATUTE_TABLE } from "../lib/legal-statute-table";

const MUST_FLAG: Array<[string, string]> = [
  ["Section 196 d, which governs tip credit rules, protects restaurant workers.", "nyll-196d"],
  ["Under NY Labor Law § 196-d, the tip credit lets employers pay less.", "nyll-196d"],
  ["Under Section 198 c, employees cannot waive wage claims that accrued before they learned of those claims.", "nyll-198c"],
  ["Overtime is required under New York Labor Law Article 6.", "nyll-art6"],
  ["The 50 employee, 75 mile rule is found at 29 U.S.C. § 2611(4)(A)(i).", "usc29-2611-4"],
  ["You can file FMLA claims with the EEOC under 29 U.S.C. § 2617.", "usc29-2617"],
  ["Under Executive Law § 297, you must file within one year.", "exec-297"],
  ["Wage statement violations carry $250 per violation under Labor Law § 198(1-d).", "nyll-198"],
  ["Under 42 U.S.C. § 1981a, the NYSHRL caps damages the same way.", "usc42-1981a"],
  ["NYC Admin. Code § 8-109 gives you three years to file with the Commission.", "nycadmin-8-109"],
  // Attorney review 2026-09-30.
  ["Under Executive Law § 300, harassment must be severe or pervasive to be actionable.", "exec-300"],
  ["Under Executive Law § 300, as under federal protections, it must be severe or pervasive.", "exec-300"],
  ["You can sue your employer in court under OSHA section 11(c).", "usc29-660c"],
  ["Under 29 U.S.C. § 660(c), you can file a lawsuit for retaliation.", "usc29-660c"],
];

const MUST_PASS: string[] = [
  "Section 196-d bars employers and managers from keeping any part of an employee's tips.",
  "Under NY Labor Law § 198-c, benefits and wage supplements such as vacation pay must be paid within 30 days.",
  "Overtime is required under 12 NYCRR § 142-2.2.",
  "The site rule at 29 U.S.C. § 2611(2)(B)(ii) excludes worksites with fewer than 50 employees within 75 miles.",
  "Under Executive Law § 297(5), you have three years to file with the Division of Human Rights.",
  "Under NYC Admin. Code § 8-109(e), you have one year, or three years for gender based harassment claims.",
  "The FLSA limitations period in 29 U.S.C. § 255(a) is two years, three if willful.",
  "Under 42 U.S.C. § 1981a, Title VII damages are capped, but there is no cap under the NYSHRL.",
  "Section 3 below explains your options.",
  "The firm has handled cases under Section 215 and Section 740 of the Labor Law.",
  // Attorney review 2026-09-30: correct federal comparisons are not errors.
  "Under Executive Law § 300, harassment no longer needs to be severe or pervasive.",
  "Unlike Title VII, which requires harassment to be severe or pervasive, Executive Law § 300 sets a lower bar.",
  "Under federal law harassment must be severe or pervasive, but Executive Law § 300 only excludes petty slights.",
  // OSHA 11(c): the complaint route is correct; "pursue" is not "sue".
  "Under OSHA section 11(c), you must file a complaint with OSHA within 30 days.",
  "You may pursue an OSHA section 11(c) complaint; only the Secretary of Labor can sue.",
  "Under 29 U.S.C. § 660(c), the Secretary of Labor may bring a lawsuit on your behalf.",
  "OSHA section 11(c) has no private right to sue, so New York workers often use Labor Law § 740.",
  // Bare 11(c) elsewhere is not OSHA.
  "Rule 11(c) sanctions can be imposed on a party who files a frivolous lawsuit.",
];

let failed = 0;
for (const [s, key] of MUST_FLAG) {
  const hits = checkStatutes(s, STATUTE_TABLE).filter((h) => h.kind === "mismatch");
  if (!hits.some((h) => h.kind === "mismatch" && h.row.key === key)) {
    failed++;
    console.log(`FAIL should flag ${key}: ${s}  -> ${hits.map((h) => (h.kind === "mismatch" ? h.row.key : "")).join(",") || "nothing"}`);
  }
}
for (const s of MUST_PASS) {
  const hits = checkStatutes(s, STATUTE_TABLE);
  if (hits.length > 0) {
    failed++;
    console.log(
      `FAIL should pass: ${s}  -> ${hits
        .map((h) => (h.kind === "mismatch" ? `${h.row.key}:${h.term}` : `unverified ${h.citation}`))
        .join(", ")}`,
    );
  }
}
// An uncatalogued citation in a sentence that names a body of law is unverified.
const unv = checkStatutes("Under NY Labor Law § 199-z, employers must post notices.", STATUTE_TABLE);
if (!unv.some((h) => h.kind === "unverified")) {
  failed++;
  console.log("FAIL unknown section should be unverified");
}
// An empty table does nothing.
if (checkStatutes("Section 196 d governs the tip credit under the Labor Law.", []).length) {
  failed++;
  console.log("FAIL empty table must be inert");
}

const total = MUST_FLAG.length + MUST_PASS.length + 2;
console.log(`${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
