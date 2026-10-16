/**
 * Keyword selection before writing (Oct 6 spec, Task 15).
 *
 *   node scripts/run.mjs scripts/check-keyword-selection.ts
 *
 * Pure: fixture candidates and existing content standing in for DataForSEO,
 * the sitemaps, Search Console, drafts and the tracker. Walks the spec's
 * done-when on the 7a4bc5e3 task.
 */
import { coverage, intentTokens, keywordProblem, seedFromTitle } from "../lib/keyword-guard";
import { chooseKeyword, type ExistingTarget, type KeywordCandidate } from "../lib/keyword-selection";

let failed = 0;
const expect = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};

// 1. Seed and guard.
const TASK = `Publish "What to Do After Being Fired" action checklist for retaliation cases`;
expect(seedFromTitle(TASK) === "what to do after being fired", `quoted seed (got "${seedFromTitle(TASK)}")`);
expect(seedFromTitle("Write a guide to FMLA leave in New York") === "a to fmla leave in new york", `task and format words removed (got "${seedFromTitle("Write a guide to FMLA leave in New York")}")`);
const JUNK = `publish "what to do after being fired" action checklist for retaliation cases new york`;
expect(keywordProblem(JUNK) !== null, "the 7a4bc5e3 keyword fails the guard");
expect(/task word "publish"/.test(keywordProblem(JUNK) ?? ""), "names the task word");
expect(keywordProblem("one two three four five six seven eight nine") === "More than 8 words", "more than eight words");
expect(keywordProblem("what to do after being fired in ny") === null, "a real keyword passes");
expect(keywordProblem("how to update your resume") !== null, "update is a task word wherever it appears");

// 2. Synonyms count as one.
expect(coverage(intentTokens("wrongful termination lawyer nyc"), intentTokens("wrongful termination attorneys new york")) === 1, "lawyer/attorneys and nyc/new york");
expect(coverage(intentTokens("what to do after being fired"), intentTokens("Four Steps to Take After an Unlawful Termination")) === 1, "fired ~ termination, what to do ~ steps");

// 3. The done-when.
const now = "2026-10-16T00:00:00Z";
const c = (keyword: string, volume: number | null, difficulty = 20): KeywordCandidate => ({ keyword, volume, difficulty, monthly: [], source: "dataforseo", fetchedAt: now });
const candidates = [
  c("what to do after being fired", 1900, 18),
  c("what to do after being fired in ny", 40, 12),
  c("what to do after getting fired", 260, 15),
  c("fired for complaining at work", 90, 9),
  c("best pizza near me", 99000, 70),
  c("what to do after being fired new york", null),
];
const existing: ExistingTarget[] = [
  { kind: "page", url: "https://katzmelinger.com/blog/2023/10/four-steps-to-take-after-an-unlawful-termination/",
    label: "https://katzmelinger.com/blog/2023/10/four-steps-to-take-after-an-unlawful-termination/",
    text: "Four Steps to Take After an Unlawful Termination /blog/2023/10/four steps to take after an unlawful termination/" },
  { kind: "page", url: "https://katzmelinger.com/practice-areas/wrongful-termination/", label: "https://katzmelinger.com/practice-areas/wrongful-termination/",
    text: "Wrongful Termination Lawyers NYC /practice areas/wrongful termination/" },
  { kind: "draft", text: "fired for complaining at work", label: 'draft 365f548e ("Fired for Complaining at Work")', draftId: "365f548e" },
  { kind: "tracker", text: "wrongful termination attorney nyc", label: "wrongful termination attorney nyc" },
];
const d = chooseKeyword({ title: TASK, incoming: JUNK, candidates, existing });
expect(d.status === "selected" && !!d.chosen && !keywordProblem(d.chosen.keyword), `a real keyword is chosen (got ${d.chosen?.keyword})`);
expect((d.chosen?.volume ?? 0) > 0 && d.chosen?.source === "dataforseo", "with DataForSEO volume");
expect(d.mode === "update" && d.updateTargetUrl === "https://katzmelinger.com/blog/2023/10/four-steps-to-take-after-an-unlawful-termination/",
  `offers an update of the 2023 blog (got ${d.mode} ${d.updateTargetUrl})`);
expect(d.rejected.some((r) => r.keyword === "fired for complaining at work" && /365f548e/.test(r.reason)), "365f548e's keyword is rejected as already targeted");
expect(d.rejected.some((r) => r.keyword === "best pizza near me" && /Off the topic/.test(r.reason)), "off-topic volume never wins");
expect(d.rejected.some((r) => /No search volume/.test(r.reason)), "no estimate stands in for a missing volume");

// 4. A deliberate, valid keyword is kept.
const typed = chooseKeyword({ title: "anything", incoming: "what to do after getting fired", candidates, existing: [] });
expect(typed.seed === "what to do after getting fired" && !!typed.chosen, `a valid typed keyword is the seed (got ${typed.seed} -> ${typed.chosen?.keyword})`);

// 5. Nothing usable: needs selection.
const none = chooseKeyword({ title: "Publish a post", candidates: [], existing: [] });
expect(none.status === "needs_selection" && none.chosen === null, "no candidates -> needs selection");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
