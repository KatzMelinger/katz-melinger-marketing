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
import { resolveTenantId } from "./tenant-context";
import { logger } from "./logger";
import { adminEmails, sendEmails } from "./notify-shared";

export type AlertType =
  | "rank_drop"
  | "aeo_loss"
  | "aeo_gain"
  | "sentiment_shift"
  | "new_citation"
  | "cannibalization"
  // Content QA (B4). A draft stopped by a gate, and newly raised critical or
  // important findings — the two things that need a person, now.
  | "content_blocked"
  | "content_finding"
  // An integration whose credential is expiring or already dead. Separate from
  // the content types because the fix is a person going to a third-party
  // console, not a draft being edited.
  | "integration_credential"
  // A cited statute/regulation's text changed since it was last checked
  // (lib/legal-authority-watch.ts). The fix is an attorney re-confirming the
  // new text, not editing a draft — closer to integration_credential than to
  // content_finding, which is why it's its own type rather than reusing one.
  | "authority_changed"
  // S13's legal alert (6.14): a social post's legal-accuracy check found a
  // critical problem (wrong forum, invented statute name, wrong figure, wrong
  // audience angle) at generation, after a rewrite, or before Schedule. The
  // fix is a human reviewing the post, but it's flagged separately from
  // content_blocked because social posts don't move through the same
  // needs_legal pipeline status blogs do.
  | "social_legal_flag"
  // The keyword rank tracker isn't producing fresh data — no snapshot in 48h,
  // a refresh wrote zero rows, or the DataForSEO balance is running low (D5).
  // The fix is someone checking the cron/API/balance, not a content action.
  | "seo_tracker_stale";

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

export async function writeAlert(args: WriteAlertArgs, tenantId?: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const tid = tenantId ?? (await resolveTenantId());

  if (args.dedupeKey) {
    const { data: existing } = await supabase
      .from("marketing_alerts")
      .select("id")
      .eq("type", args.type)
      // Dedupe against any live alert, not just unread ones — otherwise a later
      // run re-creates an alert the user already read/dismissed.
      .neq("status", "archived")
      .eq("tenant_id", tid)
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
    tenant_id: tid,
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

export async function evaluateAEOAlerts(
  currentRunId: string,
  tenantId?: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const tid = tenantId ?? (await resolveTenantId());
  const write = (a: WriteAlertArgs) => writeAlert(a, tid);

  const { data: previous } = await supabase
    .from("aeo_runs")
    .select("id")
    .eq("status", "done")
    .eq("tenant_id", tid)
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
      await write({
        type: "aeo_loss",
        severity: "high",
        source: "aeo",
        title: `Lost AI mention on ${cur.provider}`,
        body: `Prompt: "${promptText}" — we used to appear in ${cur.provider}'s answer and don't anymore.`,
        payload: { provider: cur.provider, prompt_id: cur.promptId, prompt: promptText },
        dedupeKey: `aeo_loss::${cur.promptId}::${cur.provider}::${currentRunId}`,
      });
    } else if (!prior.selfMentioned && cur.selfMentioned) {
      await write({
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
      await write({
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
        await write({
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

export async function evaluateRankAlerts(tenantId?: string): Promise<{ written: number }> {
  const supabase = getSupabaseAdmin();
  const tid = tenantId ?? (await resolveTenantId());
  const write = (a: WriteAlertArgs) => writeAlert(a, tid);
  const { data: rule } = await supabase
    .from("marketing_alert_rules")
    .select("threshold, enabled")
    .eq("type", "rank_drop")
    .eq("tenant_id", tid)
    .maybeSingle();
  if (rule && !rule.enabled) return { written: 0 };

  const minDrop = Math.max(1, Number((rule?.threshold as { min_drop?: number })?.min_drop ?? 5));
  const minVolume = Math.max(0, Number((rule?.threshold as { min_volume?: number })?.min_volume ?? 0));

  const { data: keywords, error } = await supabase
    .from("seo_keywords")
    .select("id, keyword, current_rank, previous_rank, search_volume, url, last_checked_at")
    .eq("tenant_id", tid);
  if (error) throw new Error(error.message);

  let written = 0;
  for (const kw of keywords ?? []) {
    if (kw.current_rank == null || kw.previous_rank == null) continue;
    const drop = (kw.current_rank as number) - (kw.previous_rank as number);
    if (drop < minDrop) continue;
    if ((kw.search_volume ?? 0) < minVolume) continue;

    const ok = await write({
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
  tenantId?: string,
): Promise<{ written: number }> {
  const tid = tenantId ?? (await resolveTenantId());
  const write = (a: WriteAlertArgs) => writeAlert(a, tid);
  let written = 0;
  for (const issue of issues) {
    const ok = await write({
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

// ---------------------------------------------------------------------------
// SEO tracker freshness alerts (D5) — called from the daily rank-refresh cron
// with what it just observed, since it's the one place that knows whether the
// snapshot write ran, how many rows it wrote, and what the account balance is.
// ---------------------------------------------------------------------------

/** No news for 48h is itself the news — the cron can keep firing while every
 *  run silently fails before it ever reaches the write step. Exported so the
 *  SEO Ops Hub can show the same threshold as a "stale" badge, not just wait
 *  for the alert. */
export const SEO_STALE_HOURS = 48;
/** Below this many dollars, DataForSEO calls can start failing before
 *  autorecharge catches up (or if autorecharge itself is misconfigured). */
const DEFAULT_BALANCE_ALERT_THRESHOLD = 15;

export type SeoFreshnessInputs = {
  /** ISO timestamp of the most recent snapshot row written BEFORE this run,
   *  or null if the table has never had one for this tenant. */
  lastSnapshotAt: string | null;
  /**
   * Whether the previous-snapshot timestamp could be READ. False means we do
   * not know how stale the tracker is, which is a finding in itself — distinct
   * from lastSnapshotAt being null because no snapshot exists yet.
   * Defaults to true so existing callers keep their behaviour.
   */
  lastSnapshotReadable?: boolean;
  /** Rows written by THIS run's snapshot step; null if that step threw. */
  snapshotRowsThisRun: number | null;
  /** Current DataForSEO account balance in USD, or null if unreadable. */
  balance: number | null;
};

export async function evaluateSeoTrackerFreshness(
  inputs: SeoFreshnessInputs,
  tenantId?: string,
): Promise<{ written: number }> {
  const tid = tenantId ?? (await resolveTenantId());
  // One alert per condition per day — a fixable problem still gets a fresh
  // alert (and email) tomorrow if it's still broken, but three cron
  // invocations in the same hour don't triple-notify anyone. Email follows
  // the alert: writeAlert's own dedupe is the single source of truth for
  // "is this actually new", so a re-run that finds nothing new to write also
  // sends nothing.
  const today = new Date().toISOString().slice(0, 10);
  const admins = adminEmails();
  const write = async (a: WriteAlertArgs) => {
    const wrote = await writeAlert(a, tid);
    if (wrote && admins.length > 0) {
      await sendEmails(admins, `[Huraqan] ${a.title}`, `${a.title}\n\n${a.body ?? ""}`);
    }
    return wrote;
  };
  let written = 0;

  // FAIL CLOSED. An unreadable timestamp used to skip the staleness check
  // entirely, so "the tracker stopped AND we cannot tell" produced silence —
  // the worst possible response to that combination. Low severity because it is
  // a blind spot rather than a confirmed outage.
  if (inputs.lastSnapshotReadable === false) {
    const ok = await write({
      type: "seo_tracker_stale",
      severity: "low",
      source: "seo",
      title: "Could not read the keyword tracker's last snapshot time",
      body: "The staleness check could not run, so the tracker is unmonitored rather than confirmed healthy. Check Supabase reachability and the seo_rank_snapshots table.",
      payload: { last_snapshot_readable: false },
      dedupeKey: `seo_stale_unknown::${today}`,
    });
    if (ok) written++;
  }

  if (inputs.lastSnapshotAt) {
    const ageMs = Date.now() - new Date(inputs.lastSnapshotAt).getTime();
    if (ageMs > SEO_STALE_HOURS * 3600 * 1000) {
      const ageHours = Math.round(ageMs / 3600_000);
      const ok = await write({
        type: "seo_tracker_stale",
        severity: "high",
        source: "seo",
        title: `Keyword tracker has not recorded a snapshot in ${ageHours}h`,
        body: `Last successful rank snapshot: ${inputs.lastSnapshotAt}. The daily refresh should write one every day — check the Vercel cron logs and DataForSEO connectivity.`,
        payload: { last_snapshot_at: inputs.lastSnapshotAt, age_hours: ageHours },
        dedupeKey: `seo_stale::${today}`,
      });
      if (ok) written++;
    }
  }

  if (inputs.snapshotRowsThisRun === 0 || inputs.snapshotRowsThisRun === null) {
    const failed = inputs.snapshotRowsThisRun === null;
    const ok = await write({
      type: "seo_tracker_stale",
      severity: "high",
      source: "seo",
      title: failed
        ? "Today's rank-snapshot write failed"
        : "Today's rank refresh wrote zero snapshot rows",
      body: failed
        ? "The snapshot-write step (lib/rank-history.ts) threw an error — see server logs."
        : "The refresh ran but recorded no rows for the firm or any tracked competitor today.",
      payload: { snapshot_rows: inputs.snapshotRowsThisRun },
      dedupeKey: `seo_zero_rows::${today}`,
    });
    if (ok) written++;
  }

  const threshold = Math.max(
    0,
    Number(process.env.DATAFORSEO_BALANCE_ALERT_THRESHOLD ?? DEFAULT_BALANCE_ALERT_THRESHOLD),
  );
  // FAIL CLOSED here too. A null balance skipped the check, so a broken balance
  // read meant no funding warning at all — precisely the state that precedes
  // running dry, reported as nothing.
  if (inputs.balance === null) {
    const ok = await write({
      type: "seo_tracker_stale",
      severity: "low",
      source: "seo",
      title: "Could not read the DataForSEO balance",
      body: `The balance check could not run, so a low balance would not be caught. Rankings stop updating when funds run out. Verify the DataForSEO credentials and that appendix/user_data is reachable.`,
      payload: { balance: null, threshold },
      dedupeKey: `seo_balance_unknown::${today}`,
    });
    if (ok) written++;
  }

  if (inputs.balance !== null && inputs.balance < threshold) {
    const ok = await write({
      type: "seo_tracker_stale",
      severity: inputs.balance <= 0 ? "high" : "medium",
      source: "seo",
      title: `DataForSEO balance is low: $${inputs.balance.toFixed(2)}`,
      body: `Balance is below the $${threshold} alert threshold. If autorecharge doesn't cover it in time, rankings and other SEO data will silently stop updating.`,
      payload: { balance: inputs.balance, threshold },
      dedupeKey: `seo_balance::${today}`,
    });
    if (ok) written++;
  }

  return { written };
}
