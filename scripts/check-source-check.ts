/**
 * The source check (Oct 20 spec, Task A7), checked offline with a fake model.
 *
 *   node scripts/run.mjs scripts/check-source-check.ts
 *
 * Read-only, no DB, no network. Covers what decides an attorney's workload
 * and the credibility of a "supported": which sentences are claims, which
 * entry each one belongs to, that a quote must really be in the source, that
 * a contradiction must be confirmed, and that an edit sends a claim back to
 * be checked.
 */
import {
  claimHash,
  extractSourceClaims,
  judgeClaim,
  matchEntry,
  sourceStanding,
  sourceStatus,
  type SourceCheckRecord,
} from "../lib/source-check";
import type { KbThresholdEntry } from "../lib/legal-knowledge-base";
import type { StatuteRow } from "../lib/legal-statute-table";
import type { DraftContent } from "../lib/draft-frame";

let failed = 0;
const check = (ok: boolean, what: string, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${what}${ok || !extra ? "" : `\n        ${extra}`}`);
};

const t = (o: Partial<KbThresholdEntry> & Pick<KbThresholdEntry, "key" | "label" | "unit" | "currentValue">): KbThresholdEntry =>
  ({ practiceArea: "employment", jurisdiction: "NY", region: null, effectiveDate: null, priorValue: null, priorEffectiveDate: null, scheduledValue: null, scheduledEffectiveDate: null, matchKeywords: [], enforcementPath: null, sourceUrl: null, notes: null, ...o }) as KbThresholdEntry;
const KB: KbThresholdEntry[] = [
  t({ key: "adea_employer_coverage", label: "ADEA employer coverage", jurisdiction: "federal", unit: "employees", currentValue: 20,
      matchKeywords: ["ADEA|Age Discrimination in Employment Act", "employee|employer|cover|applies|apply"], sourceUrl: "https://www.law.cornell.edu/uscode/text/29/630" }),
  t({ key: "nj_min_wage", label: "NJ minimum wage", jurisdiction: "NJ", unit: "usd_per_hour", currentValue: 15.92, sourceUrl: "https://www.nj.gov/labor/wageandhour/" }),
];
const STATUTES: StatuteRow[] = [
  { key: "usc29-213", code: "USC29", citation: "29 U.S.C. § 213", aliases: ["29 USC 213"], covers: "FLSA exemptions", notCovers: null, mismatch: [], unless: [], sourceUrl: "https://www.law.cornell.edu/uscode/text/29/213" },
  { key: "cplr-5222", code: "CPLR", citation: "CPLR 5222", aliases: [], covers: "restraining notices", notCovers: null, mismatch: [], unless: [], sourceUrl: "https://www.nysenate.gov/legislation/laws/CVP/5222" },
];

console.log("-- which sentences are claims ------------------------------------");
const claims = extractSourceClaims(
  [
    "The ADEA applies to employers with 20 or more employees.",
    "In New Jersey, the minimum wage is $15.92 an hour for most employers.",
    "Under CPLR § 5222, a restraining notice freezes the debtor's account.",
    "See Sabetay v. Sterling Drug, Inc., 69 N.Y.2d 329 (1987).",
    "A case filed in federal court typically takes one to two years from filing to trial.",
    "The company settled for $185,000 before trial.",
    "We recovered $250,000 for a client.",
    "Talk to us about your options.",
  ].join(" "),
);
const types = Object.fromEntries(claims.map((c) => [c.sentence.slice(0, 12), c.type]));
check(types["The ADEA app"] === "employee_count", "employee count claim");
check(types["In New Jerse"] === "dollar", "wage claim");
check(types["Under CPLR §"] === "statute", "statute claim");
check(types["See Sabetay "] === "case", "case claim");
check(!claims.some((c) => /typically takes/.test(c.sentence)), "a time estimate is not a claim");
check(!claims.some((c) => /settled for|recovered \$/.test(c.sentence)), "a case result is not an attorney claim");
check(!claims.some((c) => /Talk to us/.test(c.sentence)), "prose is not a claim");

console.log("\n-- which entry a claim belongs to -----------------------------------");
const m = (sentence: string, type: Parameters<typeof matchEntry>[0]["type"]) => matchEntry({ sentence, type }, KB, STATUTES);
check(m("The ADEA applies to employers with 20 or more employees.", "employee_count")?.key === "adea_employer_coverage", "ADEA coverage -> its entry");
check(m("In New Jersey, the minimum wage is $15.92 an hour.", "dollar")?.key === "nj_min_wage", "NJ wage with a unit -> NJ minimum wage");
check(m("In New Jersey, claims above $20,000 go to the Law Division.", "dollar") === null, "a $20,000 court limit is not the minimum wage");
check(m("The statute of limitations for breach of contract is six years under CPLR § 213.", "statute") === null, "CPLR § 213 is not 29 U.S.C. § 213");
check(m("Under CPLR § 5222, a restraining notice freezes the account.", "statute")?.key === "cplr-5222", "CPLR § 5222 matches the row written CPLR 5222");

console.log("\n-- allowed sources -------------------------------------------------");
check(sourceStanding("https://www.nysenate.gov/legislation/laws/LAB/740") === "primary", "NYS Senate is primary");
check(sourceStanding("https://www.eeoc.gov/x") === "primary", "EEOC is primary");
check(sourceStanding("https://www.law.cornell.edu/uscode/text/29/630") === "reproduction", "Cornell LII is a marked reproduction");
check(sourceStanding("https://www.findlaw.com/employment.html") === "not_allowed", "FindLaw is not allowed");
check(sourceStanding("https://www.somefirm.com/blog/x") === "not_allowed", "a law firm blog is not allowed");

console.log("\n-- grounding --------------------------------------------------------");
const SOURCE = "The term employer means a person engaged in an industry affecting commerce who has twenty or more employees for each working day.";
const fake = (verdict: string, quote: string) => async () => JSON.stringify({ verdict, quote, reason: "r" });
const yes = async () => true;
const no = async () => false;
const claim = "The ADEA applies to employers with 20 or more employees.";
check((await judgeClaim(claim, SOURCE, fake("supported", "who has twenty or more employees for each working day"), yes)).verdict === "supported", "supported with a verbatim quote -> supported");
check((await judgeClaim(claim, SOURCE, fake("supported", "applies to every employer with twenty employees in New York"), yes)).verdict === "not_found", "supported with an invented quote -> not accepted");
check((await judgeClaim("The ADEA applies to employers with 15 or more employees.", SOURCE, fake("contradicted", "who has twenty or more employees for each working day"), yes)).verdict === "contradicted", "a confirmed contradiction -> contradicted");
check((await judgeClaim("The ADEA applies to employers with 15 or more employees.", SOURCE, fake("contradicted", "who has twenty or more employees for each working day"), no)).verdict === "not_found", "an unconfirmed contradiction -> not accepted");
check((await judgeClaim(claim, SOURCE, async () => { throw new Error("timeout"); }, yes)).verdict === "not_found", "a model failure is never a finding against the draft");

console.log("\n-- once per version ---------------------------------------------------");
const content: DraftContent = {
  version: 1,
  h1: "Age discrimination",
  direct_answer: "",
  intro: "The ADEA applies to employers with 20 or more employees.",
  sections: [],
  faq: [],
  case_result: { present: false, text: "" },
};
const match = matchEntry({ sentence: claim, type: "employee_count" }, KB, STATUTES);
const record: SourceCheckRecord = {
  version: 1,
  checked_at: "2026-10-21T00:00:00Z",
  entries: [{ hash: claimHash(claim, match), sentence: claim, type: "employee_count", kb_key: match!.key, kb_label: match!.label, source_url: match!.sourceUrl, quote: "q", verdict: "supported", reason: "r", checked_at: "2026-10-21T00:00:00Z" }],
};
const key = (s: string) => s.toLowerCase();
const s1 = sourceStatus(content, record, KB, STATUTES, new Set(), key);
check(s1.unchecked.length === 0 && s1.current[0]?.verdict === "supported", "a checked claim is reused, not re-checked");
const edited = { ...content, intro: "The ADEA applies to employers with 15 or more employees." };
check(sourceStatus(edited, record, KB, STATUTES, new Set(), key).unchecked.length === 1, "an edited claim is checked again");
const changedKb = KB.map((e) => (e.key === "adea_employer_coverage" ? { ...e, currentValue: 25 } : e));
check(sourceStatus(content, record, changedKb, STATUTES, new Set(), key).unchecked.length === 1, "a changed knowledge base entry re-checks the claim");
const approved = sourceStatus(edited, null, KB, STATUTES, new Set([key("The ADEA applies to employers with 15 or more employees.")]), key);
check(approved.unchecked.length === 0 && approved.current[0]?.verdict === "answered", "an attorney-approved sentence counts as answered");

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
