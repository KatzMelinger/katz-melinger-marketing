/**
 * Attorney review (Oct 20 spec, Task A14), the pure parts, checked offline.
 *
 *   node scripts/run.mjs scripts/check-attorney-questions.ts
 */
import { businessDaysBetween, replaceInContent } from "../lib/attorney-questions";
import type { DraftContent } from "../lib/draft-frame";

let failed = 0;
const check = (ok: boolean, what: string, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${what}${ok || !extra ? "" : `\n        ${extra}`}`);
};

// Reminders after 2 business days, overdue after 4 (weekends do not count).
const fri = "2026-10-23T15:00:00Z";
check(businessDaysBetween(fri, new Date("2026-10-26T15:00:00Z")) === 1, "Friday to Monday is 1 business day");
check(businessDaysBetween(fri, new Date("2026-10-27T15:00:00Z")) === 2, "Friday to Tuesday: 2 (first reminder)");
check(businessDaysBetween(fri, new Date("2026-10-29T15:00:00Z")) === 4, "Friday to Thursday: 4 (overdue to Kenneth)");
check(businessDaysBetween(fri, new Date("2026-10-24T15:00:00Z")) === 0, "Friday to Saturday: 0");

// Replace with: the attorney's sentence goes where the old one was.
const c: DraftContent = {
  version: 1,
  h1: "H",
  direct_answer: "",
  intro: "Intro text.",
  sections: [{ h2: "S", body: "New Jersey employees have 300 days to file a CEPA claim. More.", kind: "standard" }],
  faq: [],
  case_result: { present: false, text: "" },
};
const r = replaceInContent(c, "New Jersey employees have 300 days to file a CEPA claim.", "New Jersey employees have one year to file a CEPA claim.");
check(!!r && r.sections[0].body.startsWith("New Jersey employees have one year"), "the sentence is replaced in its section");
check(c.sections[0].body.includes("300 days"), "the stored article is not mutated in place");
check(replaceInContent(c, "Not in the article.", "x") === null, "a sentence no longer there is refused");

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
