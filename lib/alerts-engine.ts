/**
 * Marketing alerts evaluators.
 *
 * The alerts table is a unified inbox for anything worth telling the marketer
 * about — rank drops, AI share-of-voice changes, sentiment flips, new
 * citations from competitors, cannibalization. Each evaluator reads its
 * source data, compares against the previous snapshot, and writes new rows
 * to `marketing_alerts`.
 *
 * Evaluators are idempotent within a window: we never write the same alert
 * twice for the same diff (we dedupe on a synthetic key stored in payload).
 */

import { getSupabaseAdmin } from "./supabase-server";
import { logger } from "./logger";

export type AlertType =
  | "rank_drop"
  | "aeo_loss"
  | "aeo_gain"
  | "sentiment_shift"
  | "new_citation"
  | "cannibalization";

export type AlertSeverity = "low" | "medium" | "high";

export type WriteAlertArgs = {
  type: AlertType;
  severity?: AlertSeverity;
  source?: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  /** Used to dedupe — we won't insert another 'new' alert with the same key. */
  dedupeKey?: string;
};

export async function writeAlert(args: WriteAlertArgs): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  if (args.dedupeKey) {
    const { data: existing } = await supabase
      .from("marketing_alerts")
      .select("id")
      .eq("type", args.type)
      .eq("status", "new")
      .contains("payload", { dedupe_key: args.dedupeKey })
      .limit(1);
    if (existing && existing.length > 0) return false;
  }

  const payload = {
    ...(args.payload ?? {}),
    ...(args.dedupeKey ? { dedupe_key: args.dedupeKey } : {}),
  };

  const { error } = await supabase.from("marketing_alerts").insert({
    type: args.type,
    severity: args.severity ?? "medium",
    source: args.source ?? args.type,
    title: args.title,
    body: args.body ?? null,
    payload,
  });
  if (error) {
    logger.warn({ type: args.type, error: error.message }, "Failed to write alert");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// AEO alerts — diff the latest run vs the previous done run
// ---------------------------------------------------------------------------

type AEORowSnapshot = {
  promptId: string;
  provider: string;
  selfMentioned: boolean;
  selfSentiment: string | null;
  citationDomains: Set<string>;
};

async function loadRunSnapshot(runId: string): Promise<AEORowSnapshot[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("aeo_responses")
    .select("prompt_id, provider, self_mentioned, self_sentiment, citations")
    .eq("run_id", runId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    promptId: row.prompt_id as string,
    provider: row.provider as string,
    selfMentioned: !!row.self_mentioned,
    selfSentiment: (row.self_sentiment as string | null) ?? null,
    citationDomains: new Set(
      Array.isArray(row.citations)
        ? (row.citations as { domain?: string }[]).map((c) => c.domain ?? "").filter(Boolean)
        : [],
    ),
  }));
}

async function loadPromptsByIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("aeo_prompts").select("id, prompt").in("id", ids);
  const m = new Map<string, string>();
  for (const r of data ?? []) m.set(r.id as string, r.prompt as string);
  return m;
}

export async function evaluateAEOAlerts(currentRunId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: previous } = await supabase
    .from("aeo_runs")
    .select("id")
    .eq("status", "done")
    .neq("id", currentRunId)
    .order("completed_at", { ascending: false })
    .limit(1);

  if (!previous || previous.length === 0) return; // first run — nothing to diff against

  const [now, before] = await Promise.all([
    loadRunSnapshot(currentRunId),
    loadRunSnapshot(previous[0].id),
  ]);

  const key = (s: AEORowSnapshot) => `${s.promptId}::${s.provider}`;
  const beforeMap = new Map(before.map((r) => [key(r), r]));

  const promptIds = Array.from(new Set(now.map((r) => r.promptId)));
  const prompts = await loadPromptsByIds(promptIds);

  for (const cur of now) {
    const prior = beforeMap.get(key(cur));
    if (!prior) continue;

    const promptText = prompts.get(cur.promptId) ?? "(unknown prompt)";

    // (1) AEO loss / gain
    if (prior.selfMentioned && !cur.selfMentioned) {
      await writeAlert({
        type: "aeo_loss",
        severity: "high",
        source: "aeo",
        title: `Lost AI mention on ${cur.provider}`,
        body: `Prompt: "${promptText}" — we used to appear in ${cur.provider}'s answer and don't anymore.`,
        payload: { provider: cur.provider, prompt_id: cur.promptId, prompt: promptText },
        dedupeKey: `aeo_loss::${cur.promptId}::${cur.provider}::${currentRunId}`,
      });
    } else if (!prior.selfMentioned && cur.selfMentioned) {
      await writeAlert({
        type: "aeo_gain",
        severity: "low",
        source: "aeo",
        title: `New AI mention on ${cur.provider}`,
        body: `Prompt: "${promptText}" — we now appear in ${cur.provider}'s answer.`,
        payload: { provider: cur.provider, prompt_id: cur.promptId, prompt: promptText },
        dedupeKey: `aeo_gain::${cur.promptId}::${cur.provider}::${currentRunId}`,
      });
    }

    // (2) Sentiment shift on existing mentions
    if (
      prior.selfMentioned &&
      cur.selfMentioned &&
      prior.selfSentiment &&
      cur.selfSentiment &&
      prior.selfSentiment !== cur.selfSentiment &&
      cur.selfSentiment === "negative"
    ) {
      await writeAlert({
        type: "sentiment_shift",
        severity: "high",
        source: "aeo",
        title: `Sentiment turned negative on ${cur.provider}`,
        body: `Prompt: "${promptText}" — was ${prior.selfSentiment}, now negative.`,
        payload: {
          provider: cur.provider,
          prompt_id: cur.promptId,
          prompt: promptText,
          from: prior.selfSentiment,
          to: cur.selfSentiment,
        },
        dedupeKey: `sent::${cur.promptId}::${cur.provider}::${currentRunId}`,
      });
    }

    // (3) New citation domains we hadn't seen for this (prompt, provider)
    for (const domain of cur.citationDomains) {
      if (!prior.citationDomains.has(domain)) {
        await writeAlert({
          type: "new_citation",
          severity: "low",
          source: "aeo",
          title: `New citation: ${domain}`,
          body: `${cur.provider} pulled from ${domain} for "${promptText}" — first time we've seen it for this prompt.`,
          payload: {
            provider: cur.provider,
            prompt_id: cur.promptId,
            prompt: promptText,
            domain,
          },
          dedupeKey: `cite::${cur.promptId}::${cur.provider}::${domain}`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SEO rank-drop alerts — read seo_keywords and compare current vs previous
// ---------------------------------------------------------------------------

export async function evaluateRankAlerts(): Promise<{ written: number }> {
  const supabase = getSupabaseAdmin();
  const { data: rule } = await supabase
    .from("marketing_alert_rules")
    .select("threshold, enabled")
    .eq("type", "rank_drop")
    .maybeSingle();
  if (rule && !rule.enabled) return { written: 0 };

  const minDrop = Math.max(1, Number((rule?.threshold as { min_drop?: number })?.min_drop ?? 5));
  const minVolume = Math.max(0, Number((rule?.threshold as { min_volume?: number })?.min_volume ?? 0));

  const { data: keywords, error } = await supabase
    .from("seo_keywords")
    .select("id, keyword, current_rank, previous_rank, search_volume, url, last_checked_at");
  if (error) throw new Error(error.message);

  let written = 0;
  for (const kw of keywords ?? []) {
    if (kw.current_rank == null || kw.previous_rank == null) continue;
    const drop = (kw.current_rank as number) - (kw.previous_rank as number);
    if (drop < minDrop) continue;
    if ((kw.search_volume ?? 0) < minVolume) continue;

    const ok = await writeAlert({
      type: "rank_drop",
      severity: drop >= 10 ? "high" : "medium",
      source: "seo",
      title: `Rank drop: "${kw.keyword}" ${kw.previous_rank} → ${kw.current_rank}`,
      body: `Volume ${kw.search_volume ?? 0}/mo. URL: ${kw.url ?? "—"}`,
      payload: {
        keyword: kw.keyword,
        from: kw.previous_rank,
        to: kw.current_rank,
        drop,
        volume: kw.search_volume,
        url: kw.url,
      },
      dedupeKey: `rank::${kw.id}::${kw.previous_rank}->${kw.current_rank}`,
    });
    if (ok) written++;
  }
  return { written };
}

// ---------------------------------------------------------------------------
// Cannibalization alerts — fed from the cannibalization snapshot writer
// ---------------------------------------------------------------------------

export type CannibalizationIssue = {
  keyword: string;
  urls: string[];
  severity: AlertSeverity;
};

export async function evaluateCannibalizationAlerts(
  snapshotId: string,
  issues: CannibalizationIssue[],
): Promise<{ written: number }> {
  let written = 0;
  for (const issue of issues) {
    const ok = await writeAlert({
      type: "cannibalization",
      severity: issue.severity,
      source: "seo",
      title: `Cannibalization: "${issue.keyword}" (${issue.urls.length} URLs)`,
      body: `Multiple pages targeting the same query: ${issue.urls.join(", ")}`,
      payload: { snapshot_id: snapshotId, keyword: issue.keyword, urls: issue.urls },
      dedupeKey: `cannib::${issue.keyword}::${issue.urls.sort().join("|")}`,
    });
    if (ok) written++;
  }
  return { written };
}
