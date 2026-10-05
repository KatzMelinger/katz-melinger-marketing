/**
 * Nightly call scoring through the Anthropic Message Batches API (50% off).
 *
 * submitScoringBatch — once a night: every answered, non-voicemail call of
 *   60s+ with a transcript, on or after SCORING_SINCE, whose latest score is
 *   missing or from an older PROMPT_VERSION, and that isn't already waiting in
 *   a submitted batch. One batch per tenant (rubric overrides are per tenant).
 * collectScoringBatches — hourly, free: for every submitted batch that has
 *   ended, save each result (lib/call-scoring.ts saveScore, which also
 *   attributes the call) and mark the batch collected. Errored or expired
 *   requests stay unscored and are picked up by the next night's batch.
 *   Resumable: calls that already have a current score are skipped, and a run
 *   that hits its time budget leaves the batch open for the next hour.
 *
 * Unlike the live Rescore path there is no in-line retry when the model mixes
 * rubrics; the best attempt is saved, and "Rescore" on the call page redoes it.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { callMetadata, CALL_SCORING_COLUMNS, saveScore } from "@/lib/call-scoring";
import {
  buildScoringParams,
  loadRubricSet,
  parseScoringMessage,
  PROMPT_VERSION,
  warmScoringCache,
} from "@/lib/sales-coach";
import { loadSalesStaff } from "@/lib/sales-staff";

/** Calls before this are never scored (decision 2026-10-03: score from July 2026). */
export const SCORING_SINCE = process.env.SALES_COACH_SCORING_SINCE?.trim() || "2026-07-01";
const MIN_DURATION_SECONDS = 60;
/** custom_id must match ^[a-zA-Z0-9_-]{1,64}$; CallRail ids ("CAL…") do. */
const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;

type CallRow = Record<string, unknown>;

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  return new Anthropic({ apiKey });
}

/** Calls that need a (re)score and aren't already in a pending batch. */
export async function callsNeedingScores(
  supabase: SupabaseClient,
  opts: { since?: string; tenantId?: string } = {},
): Promise<CallRow[]> {
  const calls: CallRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from("calls")
      .select(CALL_SCORING_COLUMNS)
      .eq("answered", true)
      .eq("voicemail", false)
      .gte("duration", MIN_DURATION_SECONDS)
      .not("transcription", "is", null)
      .gte("start_time", opts.since ?? SCORING_SINCE)
      .order("start_time", { ascending: true })
      .range(from, from + 999);
    if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    calls.push(...((data ?? []) as CallRow[]));
    if (!data || data.length < 1000) break;
  }

  const ids = calls.map((c) => c.id as string);
  const current = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("call_scores")
      .select("call_id")
      .in("call_id", ids.slice(i, i + 200))
      .gte("prompt_version", PROMPT_VERSION);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) current.add(r.call_id as string);
  }

  const { data: pending, error: pErr } = await supabase
    .from("call_score_batches")
    .select("call_ids")
    .eq("status", "submitted");
  if (pErr) throw new Error(pErr.message);
  const queued = new Set((pending ?? []).flatMap((b) => b.call_ids as string[]));

  return calls.filter(
    (c) =>
      !current.has(c.id as string) &&
      !queued.has(c.id as string) &&
      CUSTOM_ID.test(c.id as string) &&
      typeof c.transcription === "string" &&
      c.transcription.trim().length > 0,
  );
}

/** Queue a batch per tenant (or just `tenantId`'s calls). */
export async function submitScoringBatch(
  supabase: SupabaseClient,
  tenantId?: string,
): Promise<{ batches: { id: string; tenant_id: string; calls: number }[] }> {
  const todo = await callsNeedingScores(supabase, { tenantId });
  const byTenant = new Map<string, CallRow[]>();
  for (const c of todo) {
    const tid = c.tenant_id as string;
    byTenant.set(tid, [...(byTenant.get(tid) ?? []), c]);
  }

  const anthropic = client();
  const batches: { id: string; tenant_id: string; calls: number }[] = [];
  for (const [tenantId, calls] of byTenant) {
    const rubrics = await loadRubricSet(supabase, tenantId);
    // Load the shared prefix into a 1h cache first so the batch can read it
    // (see warmScoringCache). A failed warm-up only costs cache hits.
    try {
      const u = await warmScoringCache(anthropic, rubrics);
      console.log(
        `[call-score-batch] warmed cache: wrote=${u.cache_creation_input_tokens ?? 0} read=${u.cache_read_input_tokens ?? 0}`,
      );
    } catch (e) {
      console.warn("[call-score-batch] cache warm-up failed:", e instanceof Error ? e.message : e);
    }
    const batch = await anthropic.messages.batches.create({
      requests: calls.map((c) => ({
        custom_id: c.id as string,
        params: buildScoringParams(rubrics, callMetadata(c), (c.transcription as string).trim(), undefined, "1h"),
      })),
    });
    const { error } = await supabase.from("call_score_batches").insert({
      id: batch.id,
      tenant_id: tenantId,
      call_ids: calls.map((c) => c.id as string),
    });
    if (error) throw new Error(`batch ${batch.id} submitted but not recorded: ${error.message}`);
    batches.push({ id: batch.id, tenant_id: tenantId, calls: calls.length });
  }
  return { batches };
}

export async function collectScoringBatches(
  supabase: SupabaseClient,
  timeBudgetMs = Infinity,
): Promise<{
  collected: { id: string; scored: number; failed: number }[];
  still_running: number;
  out_of_time: boolean;
}> {
  const started = Date.now();
  const { data: pending, error } = await supabase
    .from("call_score_batches")
    .select("id, tenant_id, call_ids")
    .eq("status", "submitted");
  if (error) throw new Error(error.message);
  if (!pending?.length) return { collected: [], still_running: 0, out_of_time: false };

  const anthropic = client();
  const collected: { id: string; scored: number; failed: number }[] = [];
  let stillRunning = 0;
  let outOfTime = false;

  for (const b of pending) {
    const status = await anthropic.messages.batches.retrieve(b.id as string);
    if (status.processing_status !== "ended") {
      stillRunning++;
      continue;
    }
    const tenantId = b.tenant_id as string;
    const callIds = b.call_ids as string[];
    const [rubrics, staff, callsQ, doneQ] = await Promise.all([
      loadRubricSet(supabase, tenantId),
      loadSalesStaff(supabase, tenantId),
      supabase.from("calls").select(CALL_SCORING_COLUMNS).in("id", callIds),
      supabase.from("call_scores").select("call_id").in("call_id", callIds).gte("prompt_version", PROMPT_VERSION),
    ]);
    if (callsQ.error) throw new Error(callsQ.error.message);
    if (doneQ.error) throw new Error(doneQ.error.message);
    const callById = new Map(((callsQ.data ?? []) as CallRow[]).map((c) => [c.id as string, c]));
    const alreadySaved = new Set((doneQ.data ?? []).map((r) => r.call_id as string));

    let scored = alreadySaved.size;
    let failed = 0;
    const usage = { input: 0, cache_read: 0, cache_write: 0, output: 0 };
    for await (const item of await anthropic.messages.batches.results(b.id as string)) {
      if (Date.now() - started > timeBudgetMs) {
        outOfTime = true;
        break;
      }
      if (alreadySaved.has(item.custom_id)) continue;
      const call = callById.get(item.custom_id);
      if (!call || item.result.type !== "succeeded") {
        failed++;
        continue;
      }
      const u = item.result.message.usage;
      usage.input += u.input_tokens;
      usage.cache_read += u.cache_read_input_tokens ?? 0;
      usage.cache_write += u.cache_creation_input_tokens ?? 0;
      usage.output += u.output_tokens;
      const parsed = parseScoringMessage(item.result.message, rubrics, item.custom_id);
      if (!parsed.ok) {
        failed++;
        continue;
      }
      const saved = await saveScore({ supabase, tenantId, call, result: parsed.result, staff });
      if (saved.ok) scored++;
      else failed++;
    }
    if (outOfTime) break; // leave this batch 'submitted'; the next run resumes it

    await supabase
      .from("call_score_batches")
      .update({ status: "collected", collected_at: new Date().toISOString(), scored, failed, usage })
      .eq("id", b.id as string);
    collected.push({ id: b.id as string, scored, failed });
  }
  return { collected, still_running: stillRunning, out_of_time: outOfTime };
}
