/**
 * Legal-accuracy layer regression suite (spec 5.3).
 *
 *   node scripts/run.mjs scripts/eval-legal-layer.ts
 *
 * A labelled set of known-bad (and known-good) drafts with EXPECTED findings,
 * run against the real pipeline (lib/legal-verify.ts's runLegalCheck, plus a
 * couple of pure unit checks) so a change that breaks detection fails this
 * script instead of shipping unnoticed — the gap the spec's own note calls
 * out: "the automated way to verify the system still catches everything
 * after each change."
 *
 * Seeded from two sources, matching the spec's instruction:
 *   - the 3.14 seed traps and the live examples in Diana's Sept 18 2026 spec
 *     (the exact "As of 2025, $17.00 per hour" and "$1,275.00 ... rest of the
 *     state" sentences, and the fabricated "Wage Theft Accountability Act").
 *   - a couple of DETERMINISTIC classifier guards (negative statement,
 *     doctrine/interpretation) and a clean, legally-inert control paragraph,
 *     so an over-eager future change that starts flagging everything is
 *     caught just as reliably as one that stops flagging anything.
 *
 * Deliberately NOT exhaustive, same reasoning as
 * supabase/content_known_traps_schema.sql's own seed comment: covering every
 * one of 3.14's nine traps end to end means several live citation fetches and
 * model calls per run. This starts with the traps that most directly
 * exercise the checks built this session (3.1/3.11/3.12/3.13) plus one full
 * end-to-end case, and is meant to grow — add a case here every time a real
 * error is caught in production, the same maintenance loop
 * content_known_traps already uses.
 *
 * Environment-dependent by design in one place: the full end-to-end case
 * (NYLL 198-c) asserts only "this claim is not silently auto-cleared", not a
 * specific critical contradiction — NY_LEGISLATION_API_KEY isn't set in every
 * environment this runs in, and without it the claim correctly routes to a
 * human instead of fetching and contradicting. Both outcomes are a PASS for
 * what this suite is actually guarding: nothing here may auto-clear silently.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

import { runLegalCheck, runLegalFactChecks, toFinding, type ClaimVerdict } from "@/lib/legal-verify";
import { BULK_SOURCE_LABEL as NJ_BULK_SOURCE_LABEL } from "@/lib/nj-statute-bulk";
import type { NormalizedFinding } from "@/lib/content-findings";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

let pass = 0;
let fail = 0;
function t(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name);
  }
}

type Case = {
  name: string;
  body: string;
  /** Given the findings runLegalCheck produced, is detection correct? */
  check: (findings: NormalizedFinding[]) => boolean;
};

const CASES: Case[] = [
  {
    name: "Deterministic guard: negative statement routes to a human, not auto-cleared",
    body: "The FMLA is not enforced by the EEOC, so a complaint filed there will not preserve FMLA rights.",
    check: (f) => f.some((x) => x.claimType === "negative_statement"),
  },
  {
    name: "Deterministic guard: a doctrine/interpretation claim routes to a human",
    body:
      "Because she already filed with the New York Division of Human Rights, the election of remedies doctrine may bar her from later bringing the same claim in court.",
    check: (f) => f.some((x) => x.claimType === "interpretation"),
  },
  {
    name: "3.12: a fabricated act name is flagged",
    body:
      "The Wage Theft Accountability Act now classifies unpaid wages as criminal larceny under New York law, giving workers a powerful new tool.",
    check: (f) => f.some((x) => x.ruleId === "named_act_unverified"),
  },
  {
    name: "3.12: a real act (via a known alias) is NOT flagged as unverified",
    body:
      "Under the Family and Medical Leave Act, eligible employees may take up to 12 weeks of unpaid, job-protected leave for a serious health condition.",
    check: (f) => !f.some((x) => x.ruleId === "named_act_unverified"),
  },
  {
    name: "3.13: minimum-wage date mismatch — the spec's own '$17.00 as of 2025' example",
    body: "As of 2025, the minimum wage in New York City is $17.00 per hour.",
    check: (f) => f.some((x) => x.ruleId === "value_date_mismatch" && x.severity === "critical"),
  },
  {
    name: "3.13: overtime-threshold region mismatch — the spec's own '$1,275.00 ... rest of the state' example",
    body:
      "The overtime-exempt salary threshold is $1,275.00 per week for employees in the rest of New York State.",
    check: (f) => f.some((x) => x.ruleId === "value_region_mismatch"),
  },
  {
    name: "3.13: the correct current figure does NOT false-positive",
    body: "As of 2026, the minimum wage in New York City is $17.00 per hour.",
    check: (f) =>
      !f.some((x) =>
        ["value_date_mismatch", "value_region_mismatch", "value_internal_conflict"].includes(x.ruleId ?? ""),
      ),
  },
  {
    name: "3.13: two different figures for the same metric in one draft are both flagged",
    body:
      "The minimum wage in New York City is $17.00 per hour. Later in the same post, it says New York City workers earn $15.00 per hour minimum.",
    check: (f) => f.filter((x) => x.ruleId === "value_internal_conflict").length >= 2,
  },
  {
    name: "Control: legally-inert marketing copy produces zero legal findings",
    body: "Contact us today to schedule a free confidential case review with our experienced team.",
    check: (f) => f.length === 0,
  },
  {
    name: "3.14 end-to-end: NYLL 198-c misdescribed as an anti-waiver rule is never silently cleared",
    body: "Section 198-c of the New York Labor Law is an anti-waiver provision that voids any agreement to accept less than the statutory minimum wage.",
    // Environment-dependent by design — see the module comment.
    check: (f) => f.length > 0,
  },
];

async function runCases() {
  console.log(`Running ${CASES.length} live cases through the legal layer (tenant ${TENANT_ID}):\n`);
  for (const c of CASES) {
    let findings: NormalizedFinding[] = [];
    try {
      // Both halves. runLegalCheck is the authority loop only since the
      // deterministic fact checks were split out to run unflagged; a case
      // asserting on a wrong figure or an unknown act lives in the other one.
      const [result, facts] = await Promise.all([
        runLegalCheck(c.body, { tenantId: TENANT_ID }),
        runLegalFactChecks(c.body, { tenantId: TENANT_ID }),
      ]);
      findings = [...result.findings, ...facts];
    } catch (e) {
      t(c.name + " (threw: " + (e instanceof Error ? e.message : String(e)) + ")", false);
      continue;
    }
    t(c.name, c.check(findings));
  }
}

function runUnitChecks() {
  console.log("\nPure unit checks (no network, no DB):\n");

  const njBulkVerdict: ClaimVerdict = {
    claim: {
      sentence: "N.J.S.A. 34:19-99 prohibits retaliation against an employee who reports misconduct.",
      index: 0,
      claimType: "factual_mismatch",
      jurisdiction: "NJ",
      citations: [],
      reason: "test fixture",
      autoCheckable: true,
    },
    verdict: "supported",
    quote: null,
    reason: "The bulk export appears to support this claim.",
    sourceUrl: NJ_BULK_SOURCE_LABEL,
  };
  t(
    "3.11: a 'supported' verdict sourced ONLY from the NJ bulk export still produces a finding (never auto-clears)",
    toFinding(njBulkVerdict) !== null,
  );
  t(
    "3.11 control: a 'supported' verdict from a normal (non-bulk) source still auto-clears",
    toFinding({ ...njBulkVerdict, sourceUrl: "https://www.nysenate.gov/legislation/laws/LAB/198-C" }) === null,
  );
}

async function main() {
  runUnitChecks();
  console.log();
  await runCases();
  const total = pass + fail;
  const accuracy = total ? Math.round((pass / total) * 1000) / 10 : 0;
  console.log(`\n${pass}/${total} passed (${accuracy}%)`);
  if (fail) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
