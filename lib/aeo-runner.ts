/**
 * Orchestrates an AEO sweep: every enabled prompt × every available provider.
 *
 * The HTTP route creates a `aeo_runs` row in 'pending' state and immediately
 * fires this in the background via waitUntil(). The worker:
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

export async function executeRun(runId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const providers = getAvailableProviders();

  await supabase
    .from("aeo_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId);

  try {
    const { data: runRow, error: runErr } = await supabase
      .from("aeo_runs")
      .select("providers, prompt_count, tenant_id")
      .eq("id", runId)
      .single();
    if (runErr) throw new Error(runErr.message);
    // Everything this run reads/writes is scoped to the run's tenant.
    const tid = runRow.tenant_id as string;

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

    let responseCount = 0;
    let failureCount = 0;

    for (const prompt of prompts ?? []) {
      // Run all providers for this prompt in parallel — keeps one slow provider
      // (Perplexity) from gating the rest.
      await Promise.all(
        activeProviders.map(async (provider) => {
          const result = await safeAsk(provider, prompt.prompt);
          if (!result.ok) {
            failureCount++;
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
          responseCount++;
        }),
      );
    }

    await supabase
      .from("aeo_runs")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        response_count: responseCount,
        failure_count: failureCount,
      })
      .eq("id", runId);

    // Diff against the previous done run and write any alerts.
    try {
      await evaluateAEOAlerts(runId);
    } catch (err) {
      logger.warn(
        { runId, error: err instanceof Error ? err.message : String(err) },
        "AEO alert evaluation failed",
      );
    }
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
  }
}
