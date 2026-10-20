/**
 * Orchestrates an AEO sweep: every enabled prompt × every available provider.
 *
 * The HTTP route creates a `aeo_runs` row in 'pending' state and immediately
 * fires this in the background via after(). The worker (resumable, in
 * time-boxed chunks, see executeRun):
 *   1. Loads enabled prompts and target brands.
 *   2. For each (prompt, provider) pair, calls the provider, analyzes the
 *      response (mentions, sentiment, authority sources), and writes one
 *      `aeo_responses` row.
 *   3. After the sweep, evaluates AEO alerts (gain / loss / sentiment shift /
 *      new citation) by diffing against the previous run's responses.
 *
 * Designed to be safe to call repeatedly — providers that fail get logged on
 * the response row rather than aborting the whole run.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";
import {
  getAvailableProviders,
  safeAsk,
  type AEOProviderId,
} from "./aeo-providers";
import { analyzeResponse, type AEOTarget } from "./aeo-analysis";
import { evaluateAEOAlerts } from "./alerts-engine";
import { logger } from "./logger";

export type StartRunOptions = {
  triggeredBy?: "manual" | "cron";
  /** Override which providers to use; defaults to every available provider. */
  providers?: AEOProviderId[];
  /** Optionally restrict to a subset of prompt IDs (e.g. "test this one"). */
  promptIds?: string[];
};

export async function startRun(
  opts: StartRunOptions = {},
  tenantId?: string,
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const tid = tenantId ?? (await resolveTenantId());
  const providersAvailable = getAvailableProviders();
  const providerIds = (opts.providers ?? providersAvailable.map((p) => p.id)).filter(
    (id) => providersAvailable.some((p) => p.id === id),
  );

  if (providerIds.length === 0) {
    throw new Error(
      "No AEO providers configured. Set ANTHROPIC_API_KEY (and optionally " +
        "OPENAI_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY) to enable a run.",
    );
  }

  const promptQuery = supabase
    .from("aeo_prompts")
    .select("id")
    .eq("enabled", true)
    .eq("tenant_id", tid);
  if (opts.promptIds && opts.promptIds.length > 0) {
    promptQuery.in("id", opts.promptIds);
  }
  const { data: promptRows, error: promptErr } = await promptQuery;
  if (promptErr) throw new Error(`Failed to load prompts: ${promptErr.message}`);
  const promptCount = promptRows?.length ?? 0;
  if (promptCount === 0) throw new Error("No enabled prompts to run.");

  const { data: runRow, error: runErr } = await supabase
    .from("aeo_runs")
    .insert({
      status: "pending",
      providers: providerIds,
      prompt_count: promptCount,
      triggered_by: opts.triggeredBy ?? "manual",
      tenant_id: tid,
    })
    .select("id")
    .single();
  if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);
  return runRow.id;
}

/** Prompts run at once; each runs every provider in parallel. */
const PROMPT_CONCURRENCY = 3;
/**
 * How long one invocation keeps starting prompts. The route allows 300s and a
 * provider call can take up to 45s, so stop starting new work well before.
 */
const DEFAULT_BUDGET_MS = 200_000;

export type ExecuteResult = { finished: boolean; promptsDone: number; promptCount: number };

/**
 * Run (or resume) a sweep. A sweep used to be one loop over every prompt in
 * one serverless call; with 45 prompts it outran the 300s limit, the instance
 * was killed, and the row sat at "running" for a week (Oct 20 spec, Part 2
 * item 6). Now each call works through the prompts this run has not answered
 * yet, stops starting new ones when its time budget runs out, and reports
 * `finished: false` so the caller can continue it in a fresh invocation.
 */
export async function executeRun(
  runId: string,
  opts: { budgetMs?: number } = {},
): Promise<ExecuteResult> {
  const supabase = getSupabaseAdmin();
  const providers = getAvailableProviders();
  const startedAt = Date.now();
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;

  try {
    const { data: runRow, error: runErr } = await supabase
      .from("aeo_runs")
      .select("providers, prompt_count, tenant_id, started_at")
      .eq("id", runId)
      .single();
    if (runErr) throw new Error(runErr.message);
    // Everything this run reads/writes is scoped to the run's tenant.
    const tid = runRow.tenant_id as string;

    await supabase
      .from("aeo_runs")
      .update({
        status: "running",
        error: null,
        completed_at: null,
        ...(runRow.started_at ? {} : { started_at: new Date().toISOString() }),
      })
      .eq("id", runId);

    const enabledIds = (runRow?.providers as AEOProviderId[]) ?? [];
    const activeProviders = providers.filter((p) => enabledIds.includes(p.id));

    const { data: prompts, error: pErr } = await supabase
      .from("aeo_prompts")
      .select("id, prompt")
      .eq("enabled", true)
      .eq("tenant_id", tid);
    if (pErr) throw new Error(pErr.message);

    const { data: targetRows, error: tErr } = await supabase
      .from("aeo_targets")
      .select("id, name, type, domain, aliases")
      .eq("tenant_id", tid);
    if (tErr) throw new Error(tErr.message);

    const targets: AEOTarget[] = (targetRows ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      domain: t.domain,
      aliases: Array.isArray(t.aliases) ? (t.aliases as string[]) : [],
    }));

    // Resume: skip prompts this run already answered.
    const done = await answeredPromptIds(runId);
    const remaining = (prompts ?? []).filter((p) => !done.has(p.id));

    const runPrompt = async (prompt: { id: string; prompt: string }) => {
      // Run all providers for this prompt in parallel — keeps one slow provider
      // (Perplexity) from gating the rest.
      await Promise.all(
        activeProviders.map(async (provider) => {
          const result = await safeAsk(provider, prompt.prompt);
          if (!result.ok) {
            await supabase.from("aeo_responses").insert({
              run_id: runId,
              prompt_id: prompt.id,
              provider: provider.id,
              model: provider.defaultModel,
              error: result.error,
              tenant_id: tid,
            });
            return;
          }

          const r = result.response;
          const analysis = analyzeResponse({
            text: r.text,
            citations: r.citations,
            targets,
          });

          await supabase.from("aeo_responses").insert({
            run_id: runId,
            prompt_id: prompt.id,
            provider: provider.id,
            model: r.model,
            response_text: r.text,
            citations: r.citations,
            brand_mentions: analysis.brandMentions,
            self_mentioned: analysis.selfMentioned,
            self_position: analysis.selfPosition,
            self_sentiment: analysis.selfSentiment,
            authority_sources: analysis.authoritySources,
            latency_ms: r.latencyMs,
            tenant_id: tid,
          });
        }),
      );
    };

    let i = 0;
    while (i < remaining.length && Date.now() - startedAt < budget) {
      await Promise.all(remaining.slice(i, i + PROMPT_CONCURRENCY).map(runPrompt));
      i += PROMPT_CONCURRENCY;
      await writeCounts(runId);
    }

    const promptCount = (prompts ?? []).length;
    const promptsDone = done.size + Math.min(i, remaining.length);
    if (i < remaining.length) return { finished: false, promptsDone, promptCount };

    await writeCounts(runId);
    await supabase
      .from("aeo_runs")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", runId);

    // Diff against the previous done run and write any alerts (same tenant).
    try {
      await evaluateAEOAlerts(runId, tid);
    } catch (err) {
      logger.warn(
        { runId, error: err instanceof Error ? err.message : String(err) },
        "AEO alert evaluation failed",
      );
    }
    return { finished: true, promptsDone: promptCount, promptCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ runId, error: message }, "AEO run failed");
    await supabase
      .from("aeo_runs")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return { finished: true, promptsDone: 0, promptCount: 0 };
  }
}

/** Prompt ids this run has a response (or a logged failure) for. */
export async function answeredPromptIds(runId: string): Promise<Set<string>> {
  const { data } = await getSupabaseAdmin()
    .from("aeo_responses")
    .select("prompt_id")
    .eq("run_id", runId);
  return new Set((data ?? []).map((r) => r.prompt_id as string).filter(Boolean));
}

/** Keep response_count / failure_count current so a run shows its progress. */
async function writeCounts(runId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const [{ count: ok }, { count: failed }] = await Promise.all([
    supabase.from("aeo_responses").select("id", { count: "exact", head: true }).eq("run_id", runId).is("error", null),
    supabase.from("aeo_responses").select("id", { count: "exact", head: true }).eq("run_id", runId).not("error", "is", null),
  ]);
  await supabase
    .from("aeo_runs")
    .update({ response_count: ok ?? 0, failure_count: failed ?? 0 })
    .eq("id", runId);
}

/**
 * Ask a fresh invocation to continue a run. The continue route answers at once
 * and does the work in after(), so this call returns quickly. Needs
 * CRON_SECRET (the proxy lets that bearer through without a session); without
 * it the run still advances whenever the AEO page polls (superviseRun).
 */
export async function continueRunLater(origin: string, runId: string): Promise<void> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return;
  try {
    await fetch(`${origin}/api/aeo/runs/${runId}/continue`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.warn({ runId, error: err instanceof Error ? err.message : String(err) }, "AEO continue request failed");
  }
}

/** Run one chunk, then hand the rest to a fresh invocation. */
export async function executeAndContinue(origin: string, runId: string): Promise<void> {
  const r = await executeRun(runId);
  if (!r.finished) await continueRunLater(origin, runId);
}

/** No new response for this long: the invocation working on the run is gone. */
const STALL_MS = 6 * 60 * 1000;
/** No new response for this long: give up and show the run as failed. */
const FAIL_MS = 20 * 60 * 1000;

export type RunHealth = "ok" | "stalled" | "failed";

/**
 * Called whenever someone looks at a run. A running or pending run that has
 * made no progress for 6 minutes is stalled (its invocation was killed) and
 * the caller should resume it; after 20 minutes without progress it is marked
 * failed with the reason shown, so the page never says "Run in progress" for
 * days and Retry becomes available.
 */
export async function superviseRun(runId: string): Promise<RunHealth> {
  const supabase = getSupabaseAdmin();
  const { data: run } = await supabase
    .from("aeo_runs")
    .select("status, started_at, created_at")
    .eq("id", runId)
    .maybeSingle();
  if (!run || (run.status !== "running" && run.status !== "pending")) return "ok";
  const { data: last } = await supabase
    .from("aeo_responses")
    .select("created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: false })
    .limit(1);
  const lastProgress = Math.max(
    Date.parse((last?.[0]?.created_at as string | undefined) ?? "") || 0,
    Date.parse((run.started_at as string | null) ?? "") || 0,
    Date.parse((run.created_at as string | null) ?? "") || 0,
  );
  const idle = Date.now() - lastProgress;
  if (idle >= FAIL_MS) {
    await supabase
      .from("aeo_runs")
      .update({
        status: "failed",
        error:
          "The sweep stopped making progress for 20 minutes (a provider hung or the job was cut off). Press Retry to finish the remaining prompts.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    await writeCounts(runId);
    return "failed";
  }
  return idle >= STALL_MS ? "stalled" : "ok";
}

/**
 * Fail any run stuck in 'running' or 'pending' long past the max serverless duration — its function
 * instance was killed before it could set done/failed, so it would otherwise stay
 * "running" forever. Called at the start of the weekly sweep as a lightweight reaper.
 */
export async function reapStaleRuns(): Promise<number> {
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("aeo_runs")
    .update({
      status: "failed",
      error: "Run timed out before completing (reaped).",
      completed_at: new Date().toISOString(),
    })
    .in("status", ["running", "pending"])
    .lt("created_at", cutoff)
    .select("id");
  return data?.length ?? 0;
}
