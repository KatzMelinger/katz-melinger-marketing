/**
 * Task 24 (Oct 6 spec): a knowledge base entry entered in Rules corrects the
 * drafts that state a different figure, and switches on its date.
 *
 *   node scripts/run.mjs scripts/check-rule-changes.ts
 *
 * Pure, no DB. Walks the spec's done-when: "NJ minimum wage $16.48, effective
 * January 1, 2027, source NJ Department of Labor", starting from the live row
 * as it was stored on 2026-10-11 ($16.48 as current, dated 2027-01-01).
 */
import { resolveDates, type KbThresholdEntry } from "../lib/legal-knowledge-base";
import { checkValuesAgainst } from "../lib/legal-value-check";
import { asOfToday, kbProposal, needsVerify, type KbRow } from "../lib/rule-changes";

let failed = 0;
const expect = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};

const LIVE: KbRow = {
  entry_type: "threshold", key: "nj_min_wage", label: "NJ minimum wage - most employers",
  practice_area: "employment", jurisdiction: "NJ", region: null, unit: "usd_per_hour",
  current_value: 16.48, effective_date: "2027-01-01", prior_value: 15.92, prior_effective_date: "2026-01-01",
  scheduled_value: null, scheduled_effective_date: null, match_keywords: [], aliases: [],
  canonical_citation: null, enforcement_path: null,
  source_url: "https://www.nj.gov/labor/wageandhour/tools-resources/laws/minimumwage.shtml",
  notes: null, last_verified: "2026-09-28",
};

/** What getThresholds would hand the checker on `today`. */
function thresholds(row: KbRow, today: string): KbThresholdEntry[] {
  const r = resolveDates({ ...row, current_value: row.current_value! }, today);
  if (!r) return [];
  return [{
    key: r.key, label: r.label, practiceArea: r.practice_area, jurisdiction: r.jurisdiction, region: r.region,
    unit: r.unit as KbThresholdEntry["unit"], currentValue: r.current_value, effectiveDate: r.effective_date,
    priorValue: r.prior_value, priorEffectiveDate: r.prior_effective_date,
    scheduledValue: r.scheduled_value ?? null, scheduledEffectiveDate: r.scheduled_effective_date ?? null,
    matchKeywords: r.match_keywords, enforcementPath: r.enforcement_path, sourceUrl: r.source_url, notes: r.notes,
  }];
}

const TODAY = "2026-10-11";

// 1. The live row reads as $15.92 now, $16.48 upcoming.
const shown = asOfToday(LIVE, TODAY);
expect(shown.current_value === 15.92 && shown.scheduled_value === 16.48 && shown.scheduled_effective_date === "2027-01-01",
  `live row as of today: ${JSON.stringify([shown.current_value, shown.scheduled_value, shown.scheduled_effective_date])}`);

// 2. Diana enters the 2027 figure in the form.
const form = {
  entry_type: "threshold", key: "nj_min_wage", label: "NJ minimum wage - most employers", jurisdiction: "NJ",
  unit: "usd_per_hour", value: "16.48", effective_date: "2027-01-01",
  source_url: "https://www.nj.gov/labor/wageandhour/tools-resources/laws/minimumwage.shtml",
};
const p = kbProposal(form, shown, TODAY);
expect("row" in p, `proposal accepted (${"error" in p ? p.error : ""})`);
const row = "row" in p ? p.row : LIVE;
expect(row.current_value === 15.92 && row.scheduled_value === 16.48 && row.scheduled_effective_date === "2027-01-01",
  `stored as scheduled: ${JSON.stringify([row.current_value, row.scheduled_value, row.scheduled_effective_date])}`);
expect(row.last_verified === TODAY, "saving records today as last verified");

// 3. A source is required, and a bad date is refused.
expect("error" in kbProposal({ ...form, source_url: "" }, shown, TODAY), "no source URL is refused");
expect("error" in kbProposal({ ...form, effective_date: "1/1/2027" }, shown, TODAY), "a non ISO date is refused");

// 4. Rescan: a draft stating a different 2027 rate gets an exact correction.
const now = thresholds(row, TODAY);
const wrong = checkValuesAgainst("Starting January 1, 2027, the New Jersey minimum wage is $16.75 per hour.", now);
expect(wrong[0]?.ruleId === "value_scheduled_mismatch" && wrong[0]?.fix === 'Replace "$16.75" with "$16.48"',
  `different 2027 rate corrected: ${wrong[0]?.ruleId} ${wrong[0]?.fix}`);
expect(checkValuesAgainst("The New Jersey minimum wage is $15.92 per hour.", now).length === 0, "today's figure still passes");
expect(checkValuesAgainst("In 2027 the New Jersey minimum wage is $16.48 per hour.", now).length === 0, "the 2027 figure passes");

// 5. On the date the figure switches by itself.
const jan = thresholds(row, "2027-01-01");
expect(jan[0]?.currentValue === 16.48 && jan[0]?.priorValue === 15.92, `switched on 2027-01-01: ${jan[0]?.currentValue}`);
expect(checkValuesAgainst("The New Jersey minimum wage is $16.48 per hour.", jan).length === 0, "after the switch $16.48 is current");

// 6. A later edit today, with a past date, keeps the old figure as prior.
const today2 = kbProposal({ ...form, value: "16.00", effective_date: "2026-10-01" }, shown, TODAY);
expect("row" in today2 && today2.row.current_value === 16 && today2.row.prior_value === 15.92 && today2.row.scheduled_value === 16.48,
  `past-dated change keeps prior and schedule: ${"row" in today2 ? JSON.stringify([today2.row.current_value, today2.row.prior_value, today2.row.scheduled_value]) : ""}`);

// 7. "Verify" after 12 months.
expect(!needsVerify("2026-01-15", TODAY), "verified this year: no Verify");
expect(needsVerify("2025-10-10", TODAY), "verified 12 months and a day ago: Verify");
expect(needsVerify(null, TODAY), "never verified: Verify");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
