/**
 * Improve to Ready's guards (Oct 20 spec, Task A9) and the quality checks it
 * plans from (Task A8), checked offline.
 *
 *   node scripts/run.mjs scripts/check-improve-to-ready.ts
 *
 * Read-only, no DB, no model. The guards decide what text the system may add
 * on its own, so each one is tested on the shape of text that got through in
 * a live trial: "lasts for twenty years ... nine percent" written into an FAQ
 * by a model told not to add figures.
 */
import { newFigures, pieceProblem } from "../lib/improve-to-ready";
import { keywordIn, qualityChecks } from "../lib/quality-checks";
import { resultType, serpQualityChecks } from "../lib/quality-checks-serp";
import type { DraftContent } from "../lib/draft-frame";

let failed = 0;
const check = (ok: boolean, what: string, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${what}${ok || !extra ? "" : `\n        ${extra}`}`);
};

console.log("-- what the system may add ------------------------------------------");
const article = "A money judgment can be enforced for 20 years. Title VII applies to employers with 15 or more employees.";
check(newFigures("A judgment lasts for twenty years and accrues interest at nine percent per year.", article).length === 2, "new figures (twenty years, nine percent) are caught");
check(newFigures("Title VII applies to employers with 15 or more employees.", article).length === 0, "a figure the article already states is allowed");
check(newFigures("You may recover $5,000 and must file within 300 days.", article).join() === "$5,000,300 days", "a new dollar amount and deadline are caught");
check(newFigures("Keep copies of your pay stubs, emails and schedules.", article).length === 0, "advice with no figures passes");
check(pieceProblem("We can help — call us.") !== null, "an em dash is not kept");
check(pieceProblem("Many employment attorneys offer free initial consultations.") === "fee language", "fee language is not kept");
check(pieceProblem("Call today at 212-460-0047 to talk.") !== null, "a phone number or call to action is not kept");
check(pieceProblem("Keep a written record of every missed payment.") === null, "plain advice is kept");

console.log("\n-- quality checks (information) -------------------------------------");
const content: DraftContent = {
  version: 1,
  h1: "Collection Agency Law Firm: What Businesses Need to Know",
  direct_answer: "",
  intro: "We help businesses collect unpaid invoices.",
  sections: [{ h2: "When to call", body: "See [collections](https://katzmelinger.com/commercial-collections/).", kind: "standard" }],
  faq: [{ q: "Q1?", a: "A." }],
  case_result: { present: false, text: "" },
};
const q = Object.fromEntries(
  qualityChecks({ content, keyword: "collection agency law firm", metaTitle: "Collection Agency Law Firm | Katz Melinger", slug: "collection-agency-law-firm", practice: "collections", hasFaqSchema: true }).map((c) => [c.key, c]),
);
check(!q.direct_answer.pass && q.direct_answer.systemFixable, "a missing direct answer is a gap the system fixes");
check(!q.faq.pass && /1 FAQ question/.test(q.faq.gap ?? ""), "one FAQ question -> needs five");
check(!q.signs.pass && /business debt/.test(q.signs.gap ?? ""), "collections: signs a business debt is worth pursuing");
check(!q.keyword_placement.pass && /first 100 words/.test(q.keyword_placement.gap ?? ""), "keyword missing from the first 100 words is named");
check(!q.internal_links.pass, "one internal link -> needs three");
check(keywordIn("employment attorney nyc", "Our employment lawyers in New York City"), "keyword variants: attorney/lawyer, nyc/New York City");

console.log("\n-- search data ------------------------------------------------------");
check(resultType("https://www.firm.com/blog/what-is-a-judgment/", "What is a judgment?") === "blog", "a /blog/ question page is a blog");
check(resultType("https://www.firm.com/collection-agency-lawyer/", "Collection Agency Lawyer NYC") === "practice", "a lawyer page is a practice page");
const serp = {
  organic: Array.from({ length: 10 }, (_, i) => ({ url: `https://firm${i}.com/collection-attorney/`, title: "Collection Attorney", domain: `firm${i}.com` })),
  paa: ["How long does a judgment last in New York?", "What does a collection agency law firm do?"],
  fetchedAt: "2026-10-21T00:00:00Z",
};
const s = serpQualityChecks({ keyword: "collection agency law firm", content, format: "blog", serp });
const intent = s.checks.find((c) => c.key === "search_intent")!;
check(!intent.pass && /practice pages \(10 of 10\); this draft is a blog/.test(intent.gap ?? ""), "top results are practice pages; this draft is a blog");
check(s.uncoveredQuestions.includes("How long does a judgment last in New York?"), "an unanswered People Also Ask question is named");
check(s.checks.every((c) => /DataForSEO/.test(c.source)), "every search check names its data source and date");

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
