/**
 * The regression suite (Oct 20 spec, Task A6): runs before every deploy as
 * the first step of `npm run build`, which is Vercel's build command. A
 * deploy that breaks any case does not ship.
 *
 *   npm run test:regression
 *
 * Only checks that need no database, no network and no .env.local belong
 * here, so the suite runs the same on Vercel as on a laptop. Diana's cases
 * are in check-oct20-regressions.ts; when she finds a new error, it is added
 * there (or to the check for that area) before the fix is built.
 *
 * Not in the suite: check-task8 (one case fails on main since before
 * 2026-10-20, "image figure corrected"); the checks that read the live
 * database or the network (check-disclaimers, check-nj-retrieval, ...).
 */
import { spawn } from "node:child_process";

const SUITE = [
  "check-oct20-regressions",
  "check-source-check",
  "check-improve-to-ready",
  "check-publish",
  "check-attorney-questions",
  "check-system-health",
  "check-draft-frame",
  "check-draft-readiness",
  "check-known-traps-oct6",
  "check-known-traps-oct20",
  "check-known-traps-sept28",
  "check-osha-trap",
  "check-fee-language",
  "check-legal-constants",
  "check-legal-constants-sept28",
  "check-legal-scope",
  "check-legal-sentence-fix",
  "check-statute-table",
  "check-wage-values",
  "check-auto-rewrite",
  "check-normalize-ending",
  "check-required-elements",
  "check-compliance-task7",
  "check-task25",
  "check-finding-currency",
  "check-authority-excerpt",
  "check-answer-readiness",
  "check-keyword-provenance",
  "check-keyword-selection",
  "check-radar-rules",
  "check-calls-stats",
  "check-readability-autobreak",
  "check-rule-changes",
  "check-linkedin-mapping",
  "check-callback-export",
  "check-learn-results",
  "check-spanish",
];

const CONCURRENCY = 4;

function run(name: string): Promise<{ name: string; ok: boolean; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/run.mjs", `scripts/${name}.ts`], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (out += b));
    child.on("close", (code) => resolve({ name, ok: code === 0, tail: out.trim().split("\n").slice(-12).join("\n") }));
  });
}

const started = Date.now();
const results: { name: string; ok: boolean; tail: string }[] = [];
const queue = [...SUITE];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      const r = await run(name);
      results.push(r);
      console.log(`${r.ok ? "pass" : "FAIL"}  ${r.name}`);
    }
  }),
);

const failed = results.filter((r) => !r.ok);
for (const f of failed) console.log(`\n--- ${f.name} ---\n${f.tail}`);
console.log(
  `\nregression suite: ${results.length - failed.length}/${results.length} passed in ${Math.round((Date.now() - started) / 1000)}s` +
    (failed.length ? ". The build stops here: fix the failing case before deploying." : ""),
);
process.exit(failed.length ? 1 : 0);
