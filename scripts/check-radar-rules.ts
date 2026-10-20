/**
 * The Radar's weekly discovery rules (Oct 6 spec, Task 16).
 *
 *   node scripts/run.mjs scripts/check-radar-rules.ts
 *
 * Pure: trend, Rising, the firm-facts filter and the law change list.
 */
import { computeTrend, parseLawChanges, radarExclusion } from "../lib/radar-rules";

let failed = 0;
const expect = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`FAIL ${msg}`);
  }
};
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.001;

// 1. Trend.
const tripled = computeTrend([10, 10, 10, 10, 10, 10, 10, 10, 10, 30, 30, 30]);
expect(near(tripled.trend3m, 2) && tripled.rising, `a term that tripled is Rising (${JSON.stringify(tripled)})`);
const flat = computeTrend([500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500]);
expect(near(flat.trend3m, 0) && !flat.rising, "a flat term is not Rising");
const small = computeTrend([1, 1, 1, 1, 1, 1, 1, 1, 1, 10, 10, 10]);
expect(!small.rising, "under 30 searches a month is never Rising");
expect(computeTrend([1, 2, 3]).trend3m === null, "too little history: no trend");
const yoy = computeTrend([100, 100, 100, ...Array(9).fill(100), 140, 140, 140]);
expect(near(yoy.trendYoy, 0.4) && yoy.rising, `year over year with 15 months (${JSON.stringify(yoy)})`);
expect(computeTrend(Array(12).fill(50)).trendYoy === null, "12 months: no year over year");

// 2. Firm facts.
const drop: [string, RegExp][] = [
  ["personal injury lawyer nyc", /Practice/],
  ["workers comp attorney new jersey", /Practice/],
  ["employment lawyer for employers", /Employer-side/],
  ["how to fire an employee in ny", /Employer-side/],
  ["how to stop wage garnishment in ny", /Debtor-side/],
  ["debt relief new york", /Debtor-side/],
  ["collection agency ny", /agency/],
  ["debt collection agencies nyc", /agency/],
  ["wrongful termination lawyer california", /outside New York/],
  // Oct 20 spec, Part 2 item 4: the term Diana found at the top of Radar.
  ["what is the minimum wage in california", /outside New York/],
  ["overtime lawyer houston", /outside New York/],
  ["wage theft attorney buffalo", /City outside/],
  ["employment lawyer cherry hill", /City outside/],
];
for (const [k, re] of drop) expect(re.test(radarExclusion(k) ?? ""), `dropped: ${k} (${radarExclusion(k)})`);
for (const k of [
  "collection agency lawyer ny",
  "commercial collections attorney nj",
  "fmla lawyer",
  "information subpoena",
  "nj wage theft act",
  // Everyday words that used to read as state abbreviations (" in ", " or ").
  "wrongful termination in the workplace",
  "employment lawyer or attorney",
  "abogado de despido en la ciudad",
  "washington heights employment lawyer",
  "employment lawyer westchester",
  "wage lawyer jersey city",
]) {
  expect(radarExclusion(k) === null, `kept: ${k} (${radarExclusion(k)})`);
}

// 3. Law change list.
const lc = parseLawChanges("new jersey minimum wage 2027 | $16.48 from January 1, 2027\n\n  nyc freelance isn't free act  ");
expect(lc.length === 2 && lc[0].term === "new jersey minimum wage 2027" && lc[0].note.startsWith("$16.48"), `law changes parsed (${JSON.stringify(lc)})`);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
