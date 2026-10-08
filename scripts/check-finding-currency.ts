/**
 * Check lib/finding-currency.ts (Oct 6 spec, Task 21): a finding whose quote
 * left the draft is stale; one still present, or not a quote at all, is not.
 *
 *   node scripts/run.mjs scripts/check-finding-currency.ts
 */
import { quoteStillPresent } from "../lib/finding-currency";

const body = [
  "*Attorney Advertising*",
  "",
  "# Is Gender a Protected Class in NY?",
  "",
  "The New York State Human Rights Law (NYSHRL) applies to all employers regardless of size. See the [NYC law](https://www.nyc.gov/site/cchr/) for city rules.",
  "",
  "**Attorney's fees and costs** are available to employees who prevail.",
].join("\n");

const cases: [string, Parameters<typeof quoteStillPresent>[0], boolean | null][] = [
  // The spec's case: the corrected sentence is gone, so the blocker is stale.
  ["stale NYSHRL blocker", { source: "legal", ruleId: "known_trap", excerpt: "…harassment claims. The New York State Human Rights Law (NYSHRL) applies to employers with four or more employees for most claims. For hara…" }, false],
  ["current sentence", { source: "legal", ruleId: "trap:x", excerpt: "The New York State Human Rights Law (NYSHRL) applies to all employers regardless of size." }, true],
  // Links and emphasis in the body do not make a present quote look missing.
  ["link stripped", { source: "legal", ruleId: "trap:x", excerpt: "See the NYC law for city rules." }, true],
  ["emphasis stripped", { source: "freshness", ruleId: "fees", excerpt: "Attorney's fees and costs are available to employees who prevail." }, true],
  ["truncated old excerpt with a cut link", { source: "legal", ruleId: "trap:x", excerpt: "…regardless of size. See the [NYC law" }, true],
  // Not quotes: never judged.
  ["AI compliance paraphrase", { source: "compliance", ruleId: "NY RPC 7.1(a)", excerpt: "Entire page lacks 'Attorney Advertising' label" }, null],
  ["required element label", { source: "compliance", ruleId: "required:cta_count", excerpt: "The body has 2 closing CTAs" }, null],
  ["readability", { source: "readability", ruleId: "r1", excerpt: "anything at all here" }, null],
  ["firm fact quote gone", { source: "compliance", ruleId: "firm_managing_partner", excerpt: "Seth Katz is the managing partner of the firm." }, false],
  ["too short to judge", { source: "legal", ruleId: "trap:x", excerpt: "1 year" }, null],
];

let failed = 0;
for (const [name, f, want] of cases) {
  const got = quoteStillPresent(f, body);
  if (got !== want) {
    failed++;
    console.log(`FAIL ${name}: got ${got}, want ${want}`);
  }
}
console.log(failed ? `${failed} failed` : `all ${cases.length} passed`);
process.exit(failed ? 1 : 0);
