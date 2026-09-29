/**
 * The fee-language rule, checked against real sentences.
 *
 *   node scripts/run.mjs scripts/check-fee-language.ts
 *
 * Read-only, no DB, no model calls. The rule since 2026-09-29 (Kenneth): no fee
 * language of any kind; the free consultation offer is the only exception.
 * MUST_BLOCK is drawn from Diana's Sept 28 audit (section 4 and 11.6) — each of
 * those sentences was in a draft. MUST_PASS guards the wage content, where
 * "hourly", "costs" and "out of pocket" are ordinary words.
 */
import { blockingFeeHits, findFeeLanguage } from "../lib/fee-language";

const MUST_BLOCK: Array<[string, string]> = [
  ["We work on a contingency basis in most wage cases.", "90e667a2"],
  ["You pay no attorney's fees unless we recover money for you, at no upfront cost.", "90e667a2"],
  ["Many firms offer free or low cost initial consultations.", "9b01853e"],
  ["If you win, the employer must pay your legal fees.", "5d68332e"],
  ["You can pursue the claim without having to pay legal fees out of pocket.", "fb684e7e"],
  ["The FLSA lets you recover attorneys' fees and costs.", "fee shifting"],
  ["Most employment lawyers handle overtime cases on contingency.", "market statement, now blocked"],
  ["Some firms charge a flat fee for severance review.", "eb5d488b"],
  ["Collection firms often bill hourly or take a percentage of the recovery.", "48d5e3f7"],
  ["Our team can review your case at no cost.", "at no cost"],
  ["A retainer is required before work begins.", "retainer"],
];

const MUST_PASS: Array<[string, string]> = [
  ["Call today for a Free Confidential Case Evaluation.", "the offer"],
  ["We offer a free consultation.", "free consultation allowed"],
  ["Initial consultations are free.", "free consultation allowed"],
  ["Hourly employees are entitled to overtime at one and a half times their regular rate.", "hourly wage sense"],
  ["Your hourly rate must be at least the minimum wage.", "hourly wage sense"],
  ["Employers may not make you pay out of pocket for uniforms.", "out of pocket, wage sense"],
  ["Keep receipts for your out-of-pocket medical costs.", "costs, not fees"],
  ["An offer contingent on your start date is not a contract.", "contingent, not a fee"],
];

let failed = 0;
for (const [s, why] of MUST_BLOCK) {
  const hits = blockingFeeHits(findFeeLanguage(s));
  if (hits.length === 0) {
    failed++;
    console.log(`FAIL should block (${why}): ${s}`);
  }
}
for (const [s, why] of MUST_PASS) {
  const hits = findFeeLanguage(s);
  if (hits.length > 0) {
    failed++;
    console.log(`FAIL should pass (${why}): ${s}  -> ${hits.map((h) => h.rule).join(", ")}`);
  }
}
const total = MUST_BLOCK.length + MUST_PASS.length;
console.log(`${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
