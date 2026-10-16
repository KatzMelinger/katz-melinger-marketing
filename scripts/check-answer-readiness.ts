/**
 * Answer readiness (Oct 6 spec, Task 19).
 *
 *   node scripts/run.mjs scripts/check-answer-readiness.ts
 */
import { answerReadiness } from "../lib/answer-readiness";
import { bylineFor } from "../lib/firm-fact-findings";
import { KENNETH_KATZ } from "../lib/authors";

let failed = 0;
const expect = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};

const ready = [
  "Attorney Advertising",
  "",
  "# How Long Is a Judgment Good For in New York?",
  "",
  bylineFor(KENNETH_KATZ),
  "",
  "A New York money judgment can be enforced for 20 years, and a judgment lien on real property lasts 10 years, which can be extended.",
  "",
  "## The rules",
  "",
  "A judgment lien lasts 10 years under [CPLR 5203](https://www.nysenate.gov/legislation/laws/CVP/5203).",
  "",
  "## FAQ",
  "",
  "### Can the lien be extended?",
].join("\n");
const r = answerReadiness(ready);
expect(r.length === 1 && /primary source/.test(r[0]), `only the unsourced answer sentence is flagged (got ${JSON.stringify(r)})`);
expect(bylineFor(KENNETH_KATZ).includes("https://katzmelinger.com/attorney/kenneth-j-katz/"), "byline links to the bio");

const notReady = [
  "# Overtime in New York",
  "",
  "By Nicole Grunfeld, Katz Melinger PLLC",
  "",
  Array(70).fill("word").join(" "),
  "",
  "Employers must pay overtime after 40 hours a week.",
].join("\n");
const n = answerReadiness(notReady);
expect(n.some((x) => /70 words/.test(x)), "answer over 60 words");
expect(n.some((x) => /no FAQ/.test(x)), "no FAQ section");
expect(n.some((x) => /does not link to the author's bio/.test(x)), "unlinked byline");
expect(n.some((x) => /cite no primary source/.test(x)), "unsourced figure");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
