/**
 * Score (or re-score) the call backlog with the current scorer.
 *
 * The hourly cron keeps up with new calls; this clears what it never reached
 * and brings older scores up to the current PROMPT_VERSION. Before v3, any
 * call the cron scored was graded on the consultation (sales) rubric
 * regardless of what kind of call it was, and nothing recorded who handled it.
 *
 * Picks every answered, non-voicemail call of at least 60 seconds with a
 * transcript, on or after --since (default 2026-01-01), whose latest score is
 * missing or older than the current PROMPT_VERSION.
 *
 * Dry-run by default: reports how many calls qualify and an estimated cost.
 * Nothing is sent to Claude or written until you pass --apply.
 *
 *   node scripts/run.mjs scripts/score-calls-backfill.ts
 *   node scripts/run.mjs scripts/score-calls-backfill.ts --apply --limit 20
 *   node scripts/run.mjs scripts/score-calls-backfill.ts --apply --since 2026-06-01
 *
 * Must go through scripts/run.mjs (it imports lib/ code with `@/` aliases).
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 * and (for the Gabriel tie-break) AIRTABLE_API_TOKEN, read from .env.local.
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { CALL_SCORING_COLUMNS, scoreAndSave } from "../lib/call-scoring";
import { PROMPT_VERSION } from "../lib/sales-coach";
import { loadSalesStaff } from "../lib/sales-staff";

/** Rough per-call cost on Opus 5.5 at medium effort (cached SOPs, ~4k-token transcript). */
const EST_COST_PER_CALL_USD = 0.1;
const CONCURRENCY = 4;

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

function argValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const since = argValue(args, "--since") ?? "2026-01-01";
  const limit = Number(argValue(args, "--limit") ?? "0") || Infinity;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Candidate calls, paged (PostgREST caps a response at 1000 rows).
  const calls: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("calls")
      .select(CALL_SCORING_COLUMNS)
      .eq("answered", true)
      .eq("voicemail", false)
      .gte("duration", 60)
      .not("transcription", "is", null)
      .gte("start_time", since)
      .order("start_time", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    calls.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }

  // Latest prompt_version per call.
  const latest = new Map<string, number>();
  const ids = calls.map((c) => c.id as string);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("call_scores")
      .select("call_id, prompt_version")
      .in("call_id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      latest.set(r.call_id as string, Math.max(latest.get(r.call_id as string) ?? 0, r.prompt_version as number));
    }
  }

  const todo = calls.filter((c) => (latest.get(c.id as string) ?? 0) < PROMPT_VERSION).slice(0, limit);
  const neverScored = todo.filter((c) => !latest.has(c.id as string)).length;
  console.log(
    `Calls since ${since}: ${calls.length} eligible, ${todo.length} to score ` +
      `(${neverScored} never scored, ${todo.length - neverScored} on an older scorer).`,
  );
  console.log(`Estimated cost: ~$${Math.round(todo.length * EST_COST_PER_CALL_USD)}`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply to score.");
    return;
  }

  const staffByTenant = new Map<string, Awaited<ReturnType<typeof loadSalesStaff>>>();
  let done = 0;
  let failed = 0;
  const attributed: Record<string, number> = {};
  let next = 0;

  async function worker() {
    while (next < todo.length) {
      const call = todo[next++];
      const tid = call.tenant_id as string;
      if (!staffByTenant.has(tid)) staffByTenant.set(tid, await loadSalesStaff(supabase, tid));
      const out = await scoreAndSave({ supabase, tenantId: tid, call, staff: staffByTenant.get(tid)! });
      done++;
      if (out.ok) {
        const who = out.attribution.staff?.full_name ?? `(${"reason" in out.attribution ? out.attribution.reason : "none"})`;
        attributed[who] = (attributed[who] ?? 0) + 1;
        console.log(`[${done}/${todo.length}] ${call.id} ${out.result.rubric_type} ${out.result.overall_score} ${who}`);
      } else {
        failed++;
        console.log(`[${done}/${todo.length}] ${call.id} FAILED: ${out.error}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nDone: ${done - failed} scored, ${failed} failed.`);
  console.log("Handled by:", Object.entries(attributed).sort((a, b) => b[1] - a[1]));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
