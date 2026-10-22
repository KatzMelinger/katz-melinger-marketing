/**
 * Oct 20 spec, Tasks A10 and A15: the pure parts of learning from results.
 * When snapshots fall due, the Search Console match for a page, the
 * Underperforming rule, related AI prompts, the check-vs-results report,
 * reading hand corrections out of an edit, and the live page text.
 *
 *   node scripts/run.mjs scripts/check-learn-results.ts
 */
import { checkReport, dueSnapshot, gscForPage, relatedPrompt, underperformingReasons, type ResultSnapshot } from "../lib/page-results";
import { correctionPairs, isFactCorrection } from "../lib/regression-cases";
import { pageText } from "../lib/live-page-scan";
import type { QualityCheck } from "../lib/quality-checks";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const pub = "2026-07-01T12:00:00Z";
const at = (days: number) => Date.parse(pub) + days * 86_400_000;
check("nothing due before 30 days", dueSnapshot(pub, {}, at(29)) === null);
check("30 day snapshot due at 30 days", dueSnapshot(pub, {}, at(31)) === 30);
check("30 day snapshot not repeated", dueSnapshot(pub, { d30: {} as ResultSnapshot }, at(45)) === null);
check("90 day snapshot due at 90 days", dueSnapshot(pub, { d30: {} as ResultSnapshot }, at(91)) === 90);
check("a missed 30 day snapshot is skipped once 90 is due", dueSnapshot(pub, {}, at(95)) === 90);

const rows = [
  { query: "unpaid overtime lawyer nyc", page: "https://www.katzmelinger.com/blog/unpaid-overtime/", clicks: 4, impressions: 300, ctr: 0.013, position: 14.26 },
  { query: "overtime lawyers new york city", page: "https://katzmelinger.com/blog/unpaid-overtime", clicks: 1, impressions: 90, ctr: 0.011, position: 22 },
  { query: "unpaid overtime lawyer nyc", page: "https://katzmelinger.com/other/", clicks: 50, impressions: 900, ctr: 0.05, position: 3 },
];
const g = gscForPage(rows, "https://katzmelinger.com/blog/unpaid-overtime/", "unpaid overtime lawyer nyc");
check("GSC: exact keyword on this page only", g.position === 14.3 && g.clicks === 4, JSON.stringify(g));
check("GSC: page totals across its queries", g.page_clicks === 5 && g.page_impressions === 390);
const g2 = gscForPage(rows, "https://katzmelinger.com/blog/unpaid-overtime/", "overtime lawyer nyc");
check("GSC: near keyword match when no exact query", g2.clicks === 4, JSON.stringify(g2));

const snap = (s: Partial<ResultSnapshot>): ResultSnapshot => ({ day: 90, measured_at: pub, keyword: "k", position: 5, impressions: 0, clicks: 20, ctr: 0, page_clicks: 0, page_impressions: 0, ai_prompts: 0, ai_cited: 0, calls: 0, forms: 0, ...s });
check("performing: top 20", underperformingReasons(snap({ position: 12, clicks: 2 })).length === 0);
check("performing: outside 20 but 10+ clicks", underperformingReasons(snap({ position: 31, clicks: 10 })).length === 0);
check("underperforming: outside 20 with few clicks", underperformingReasons(snap({ position: 31, clicks: 3 })).length === 1);
check("underperforming: not ranking at all", underperformingReasons(snap({ position: null, clicks: 0 }))[0]?.startsWith("Not ranking"));
check("underperforming: no related AI answer cites the firm", underperformingReasons(snap({ ai_prompts: 4, ai_cited: 0 })).length === 1);
check("no AI prompts tracked is not a failure", underperformingReasons(snap({ ai_prompts: 0, ai_cited: 0 })).length === 0);

check("related prompt: shares the topic words", relatedPrompt("unpaid overtime lawyer nyc", "Who is the best lawyer for unpaid overtime in New York?"));
check("unrelated prompt", !relatedPrompt("unpaid overtime lawyer nyc", "How do I collect a judgment in New Jersey?"));

const c = (key: string, pass: boolean): QualityCheck => ({ key: key as QualityCheck["key"], label: key, pass, gap: null, source: "", systemFixable: false });
const report = checkReport([
  ...Array.from({ length: 4 }, () => ({ performing: true, checks: [c("faq", true), c("schema", true)] })),
  ...Array.from({ length: 4 }, () => ({ performing: false, checks: [c("faq", false), c("schema", true)] })),
]);
check("report: a check that separates the groups predicts", report.find((r) => r.key === "faq")?.predicts === "yes");
check("report: a check that passes everywhere does not", report.find((r) => r.key === "schema")?.predicts === "no");
check("report: too few pages is not enough data", checkReport([{ performing: true, checks: [c("faq", true)] }])[0].predicts === "not enough data");

const oldText = [
  "Under New York law, most employees must be paid overtime at one and one half times their regular rate.",
  "The minimum wage in New York City is $15.50 per hour for most employers.",
  "Call us today to talk about your case with our team.",
].join("\n\n");
const newText = [
  "Under New York law, most employees must be paid overtime at one and one half times their regular rate.",
  "The minimum wage in New York City is $16.50 per hour for most employers.",
  "Call us today to talk about your situation with our team.",
].join("\n\n");
const pairs = correctionPairs(oldText, newText);
check("two corrections read out of the edit", pairs.length === 2, JSON.stringify(pairs));
check("a changed figure is a fact correction", isFactCorrection(pairs.find((p) => p.before.includes("$15.50"))!));
check("a changed word is not a fact correction", !isFactCorrection(pairs.find((p) => p.before.includes("Call us"))!));
const rewrite = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} says something rather different about wages here.`).join(" ");
check("a rewrite is not read as corrections", correctionPairs(oldText, rewrite).length === 0);
check("no change, no corrections", correctionPairs(oldText, oldText).length === 0);

const html = `<html><nav>Menu Home About</nav><main><h1>Overtime</h1><p>Employers with 15 or more employees&nbsp;must comply.</p></main><footer>Footer text</footer></html>`;
const t = pageText(html);
check("live page text is the article, not the menu", t.includes("15 or more employees must comply") && !t.includes("Menu") && !t.includes("Footer"), t);

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
