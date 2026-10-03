/**
 * Run the nightly call-scoring batch by hand (lib/call-score-batch.ts).
 *
 * Dry-run by default: how many calls need a score (since SCORING_SINCE,
 * 2026-07-01, or never scored / scored by an older scorer) and an estimated
 * cost. Nothing is sent to Claude until you pass --submit.
 *
 *   node scripts/run.mjs scripts/score-calls-batch.ts             # report
 *   node scripts/run.mjs scripts/score-calls-batch.ts --submit    # queue a batch
 *   node scripts/run.mjs scripts/score-calls-batch.ts --collect   # save finished results
 *
 * Batches usually finish within an hour (24h at most); the hourly cron
 * collects them too, so --collect is only needed to see results sooner.
 *
 * Must go through scripts/run.mjs (it imports lib/ code with `@/` aliases).
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 * and (for the Gabriel tie-break) AIRTABLE_API_TOKEN, read from .env.local.
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { callsNeedingScores, collectScoringBatches, SCORING_SINCE, submitScoringBatch } from "../lib/call-score-batch";

/** Measured 2026-10-03: ~$0.10/call on Opus 5.5 at medium effort; batches are half price. */
const EST_BATCH_COST_PER_CALL_USD = 0.05;

function loadEnv() {
  let raw = "";
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    console.error("Could not read .env.local from the current directory.");
    process.exit(1);
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  if (args.includes("--collect")) {
    console.log(JSON.stringify(await collectScoringBatches(supabase), null, 2));
    return;
  }

  const todo = await callsNeedingScores(supabase);
  console.log(
    `Calls since ${SCORING_SINCE} needing a score: ${todo.length} ` +
      `(estimated ~$${Math.round(todo.length * EST_BATCH_COST_PER_CALL_USD)} at batch pricing).`,
  );
  if (!args.includes("--submit")) {
    console.log("Dry run. Re-run with --submit to queue the batch.");
    return;
  }
  console.log(JSON.stringify(await submitScoringBatch(supabase), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
