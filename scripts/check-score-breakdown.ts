/**
 * Oct 20 spec, Task A11: every score opens a breakdown, each point lost has a
 * reason and a named check, and the points add up to 100 minus the score.
 *
 *   node scripts/run.mjs scripts/check-score-breakdown.ts
 */
import { scoreBreakdowns, type BreakdownInput } from "../lib/score-breakdown";
import { heuristicAEO } from "../lib/content-analysis";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const seo = { titleQuality: 60, headingStructure: 100, keywordPlacement: 50, authorityLinks: 100, contentDepth: 100, schemaReadiness: 70 };
const seoScore = Math.round(60 * 0.18 + 100 * 0.15 + 50 * 0.22 + 100 * 0.18 + 100 * 0.17 + 70 * 0.1);
const input: BreakdownInput = {
  seo_score: seoScore,
  seo_breakdown: seo,
  seo_findings: ['Keyword "overtime lawyer" missing from title.', "Recommended structured data: Article schema."],
  aeo_score: 62,
  aeo_findings: [],
  aeo_deductions: [
    { points: 8, reason: "No statistics or specific numbers", check: "direct_answer" },
    { points: 6, reason: "No explicit definitions", check: "direct_answer" },
    { points: 6, reason: "No bullet or numbered lists", check: "signs" },
    { points: 6, reason: "No external source references", check: "sources" },
    { points: 4, reason: "650 words (800+ earns the depth points)", check: "topic_coverage" },
    { points: 6, reason: "No section headings", check: "topic_coverage" },
    { points: 2, reason: "Not reachable by the heuristic (its maximum is 98)", check: null },
  ],
  cash_score: 70,
  cash_breakdown: { conversationalAuthority: 80, answerCompleteness: 70, sourceExpertise: 60, humanAttribution: 75 },
  readability_score: 80,
  readability_rules: { applicable: 15, failed: [{ id: "r01", label: "Sentences over 25 words" }, { id: "r04", label: "Passive voice" }, { id: "r07", label: "Paragraphs over 4 sentences" }] },
  brand_voice_score: 85,
  brand_voice_deductions: [{ points: 10, reason: "Too formal in the intro", check: "brand_voice" }, { points: 5, reason: "One sentence of jargon", check: "brand_voice" }],
  linkability_score: 40,
  linkability_findings: ["No original data."],
};
const b = scoreBreakdowns(input);
const by = (k: string) => b.find((x) => x.key === k)!;
const total = (k: string) => Math.round(by(k).lines.reduce((n, l) => n + l.points, 0));

check("six scores", b.length === 6 && ["seo", "aeo", "cash", "readability", "brand_voice", "linkability"].every((k) => by(k)));
for (const k of ["seo", "aeo", "cash", "readability", "brand_voice", "linkability"]) {
  const s = by(k).score!;
  check(`${k}: points lost add up to 100 minus ${s}`, Math.abs(total(k) - (100 - s)) <= 1, `${total(k)}`);
}
check("SEO: keyword placement is the biggest loss, linked to its check", by("seo").lines[0].check === "keyword_placement" && by("seo").lines[0].reason.includes("missing from title"), JSON.stringify(by("seo").lines[0]));
check("SEO: full parts lose nothing", !by("seo").lines.some((l) => l.reason.startsWith("Headings")));
check("every itemized line names a check", ["seo", "aeo", "cash", "readability", "brand_voice"].every((k) => by(k).lines.filter((l) => !/Rounding|heuristic/.test(l.reason)).every((l) => l.checkLabel)));
check("readability: each failed rule costs one fifteenth", Math.abs(by("readability").lines[0].points - 6.7) < 0.1);
check("fixable checks say so", by("aeo").lines.some((l) => l.fixable) && !by("brand_voice").lines.some((l) => l.fixable));
check("an unitemized model score says so instead of guessing", by("linkability").lines.length === 1 && by("linkability").lines[0].reason.startsWith("Not itemized"));
check("summary reads like the spec's example", /^SEO \d+: keyword placement 50\/100 \(minus 11\)/.test(by("seo").summary), by("seo").summary);

// The real AEO scorer: its deductions always account for the whole gap.
const bodies = [
  "Short note.",
  [
    "## What is overtime?",
    "Overtime is defined as hours over 40. According to the DOL report, 30% of workers are owed it.",
    "- one",
    "- two",
    "Q: Who pays? " + "word ".repeat(900),
  ].join("\n"),
  ["## Heading only", "word ".repeat(500)].join("\n"),
];
for (const [i, body] of bodies.entries()) {
  const r = heuristicAEO(body);
  const lost = r.deductions.reduce((n, d) => n + d.points, 0);
  check(`AEO scorer body ${i + 1}: deductions equal 100 minus ${r.score}`, lost === 100 - r.score, String(lost));
}

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
