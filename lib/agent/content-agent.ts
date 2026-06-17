/**
 * Autonomous content agent — research → draft → analyze → compliance-gate →
 * queue for human approval. Stops at the approval gate; it NEVER publishes.
 *
 * A deterministic plain-TS orchestrator (not a free-form tool-use chat loop)
 * that chains capabilities that already exist:
 *   1. runOpportunityPipeline()  — source/score/research/brief the work-list.
 *   2. generateMultiFormat()     — draft the long-form article for a winner.
 *   3. analyzeDraft()            — full scorecard (readability/SEO/AEO/etc).
 *   4. runComplianceGate()       — the attorney-advertising HARD GATE.
 *
 * Outcome per item:
 *   - PASS  → content_drafts.status = 'review'      (enters approval inbox)
 *   - HOLD  → content_drafts.status = 'needs_legal'  (held; never auto-surfaced)
 * A research packet flagged `legal_review_required` is always held, regardless
 * of the compliance score.
 *
 * Every run is recorded in `agent_runs` — the activity log / approval inbox.
 * All writes go through getTenantJobDb(tenantId) (service role, tenant-stamped)
 * because the agent runs in a cron/background context with no user session.
 */

import { getTenantJobDb } from "@/lib/tenant-db";
import {
  runOpportunityPipeline,
  type ScoredOpportunity,
} from "@/lib/opportunity-pipeline";
import { draftTopicToReview } from "@/lib/agent/draft-to-review";

export type AgentItemAction =
  | "queued_for_review"
  | "held_needs_legal"
  | "skipped_duplicate"
  | "skipped_below_threshold"
  | "would_produce" // dry-run only
  | "error";

export type AgentItemResult = {
  keyword: string;
  draftId: string | null;
  batchId?: string;
  worthScore: number;
  action: AgentItemAction;
  legalReviewRequired?: boolean;
  compliance?: {
    pass: boolean;
    status: string;
    score: number;
    highSeverityCount: number;
    violations: { rule: string; severity: string; reason: string }[];
    suggestedRewrite: string;
  };
  error?: string;
};

export type AgentRunResult = {
  runId: string | null;
  tenantId: string;
  dryRun: boolean;
  produced: AgentItemResult[];
  held: AgentItemResult[];
  skipped: AgentItemResult[];
  summary: string;
  error?: string;
};

const DEFAULT_MAX_ITEMS = 3;

/** Run one pass of the autonomous content agent for a single tenant. */
export async function runContentAgent(args: {
  tenantId: string;
  practiceArea?: string | null;
  /** Per-run budget cap — max winners to draft (protects API spend). */
  maxItems?: number;
  /** Minimum opportunity worth-score (0-100) required to draft. */
  minWorthScore?: number;
  /** Compliance gate threshold (0-100). */
  minComplianceScore?: number;
  /** 'manual' for UI-triggered runs, 'cron' for scheduled. */
  trigger?: "cron" | "manual";
  /** Plan only — produce nothing, write nothing. */
  dryRun?: boolean;
}): Promise<AgentRunResult> {
  const tenantId = args.tenantId;
  const maxItems = Math.min(Math.max(args.maxItems ?? DEFAULT_MAX_ITEMS, 1), 10);
  const minWorthScore = args.minWorthScore ?? 0;
  const dryRun = args.dryRun === true;
  const practiceArea = args.practiceArea ?? null;
  const db = getTenantJobDb(tenantId);

  const produced: AgentItemResult[] = [];
  const held: AgentItemResult[] = [];
  const skipped: AgentItemResult[] = [];

  // Open the run record up front so a crash mid-run still leaves a trail.
  let runId: string | null = null;
  if (!dryRun) {
    const { data, error } = await db
      .insert("agent_runs", {
        trigger: args.trigger ?? "cron",
        status: "running",
      })
      .select("id")
      .single();
    if (error) {
      return {
        runId: null,
        tenantId,
        dryRun,
        produced,
        held,
        skipped,
        summary: "",
        error: `Failed to open agent run: ${error.message}`,
      };
    }
    runId = (data?.id as string | undefined) ?? null;
  }

  try {
    // 1. Pick work — source/score/research/brief the winners.
    const pipeline = await runOpportunityPipeline({
      practiceArea,
      topN: maxItems,
      deep: true,
    });

    // Idempotency — never re-draft a topic already in flight. content_pipeline
    // stores the agent's keyword in `keywords`; compare case-insensitively.
    const inflight = await loadInflightKeywords(db);

    let drafted = 0;
    for (const winner of pipeline.winners) {
      if (drafted >= maxItems) break;

      const key = winner.keyword.trim().toLowerCase();

      if (winner.worthScore < minWorthScore) {
        skipped.push({
          keyword: winner.keyword,
          draftId: null,
          worthScore: winner.worthScore,
          action: "skipped_below_threshold",
        });
        continue;
      }

      if (inflight.has(key)) {
        skipped.push({
          keyword: winner.keyword,
          draftId: null,
          worthScore: winner.worthScore,
          action: "skipped_duplicate",
        });
        continue;
      }

      if (dryRun) {
        produced.push({
          keyword: winner.keyword,
          draftId: null,
          worthScore: winner.worthScore,
          action: "would_produce",
          legalReviewRequired: winner.legalReviewRequired,
        });
        drafted++;
        continue;
      }

      try {
        const item = await draftAndGate({
          db,
          tenantId,
          runId,
          winner,
          practiceArea,
          minComplianceScore: args.minComplianceScore,
        });
        if (item.action === "held_needs_legal") held.push(item);
        else produced.push(item);
        drafted++;
      } catch (err) {
        produced.push({
          keyword: winner.keyword,
          draftId: null,
          worthScore: winner.worthScore,
          action: "error",
          error: err instanceof Error ? err.message : "draft failed",
        });
        drafted++;
      }
    }

    const summary = buildSummary({
      dryRun,
      produced,
      held,
      skipped,
      considered: pipeline.candidatesConsidered,
    });

    if (!dryRun && runId) {
      await db.raw
        .from("agent_runs")
        .update({
          status: "completed",
          finished_at: new Date().toISOString(),
          items_produced: produced,
          items_held: held,
          items_skipped: skipped,
          summary,
        })
        .eq("id", runId)
        .eq("tenant_id", tenantId);
    }

    return { runId, tenantId, dryRun, produced, held, skipped, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : "agent run failed";
    if (!dryRun && runId) {
      await db.raw
        .from("agent_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          items_produced: produced,
          items_held: held,
          items_skipped: skipped,
          error: message,
        })
        .eq("id", runId)
        .eq("tenant_id", tenantId);
    }
    return {
      runId,
      tenantId,
      dryRun,
      produced,
      held,
      skipped,
      summary: "",
      error: message,
    };
  }
}

/**
 * Draft one winner, analyze it, run the compliance hard gate, and persist the
 * outcome (status + linked pipeline row). Returns the item result.
 *
 * The generate → analyze → gate → persist work lives in the shared
 * draftTopicToReview() helper so chat-created (Peggy) and agent-created content
 * follow the identical path into the approval queue.
 */
async function draftAndGate(args: {
  db: ReturnType<typeof getTenantJobDb>;
  tenantId: string;
  runId: string | null;
  winner: ScoredOpportunity;
  practiceArea: string | null;
  minComplianceScore?: number;
}): Promise<AgentItemResult> {
  const { db, tenantId, runId, winner } = args;

  const outcome = await draftTopicToReview({
    db,
    tenantId,
    topic: winner.keyword,
    practiceArea: args.practiceArea,
    format: "blog",
    targetKeywords: winner.brief?.targetKeywords,
    seoBriefHeadings: winner.brief?.headings,
    minComplianceScore: args.minComplianceScore,
    originSource: "agent",
    runId,
    packetId: winner.packetId ?? null,
    legalReviewRequired: winner.legalReviewRequired === true,
    notePrefix: `Autonomous agent · worth ${winner.worthScore}`,
  });

  const action: AgentItemAction = outcome.error
    ? "error"
    : outcome.pass
      ? "queued_for_review"
      : "held_needs_legal";

  return {
    keyword: winner.keyword,
    draftId: outcome.draftId,
    batchId: outcome.batchId ?? undefined,
    worthScore: winner.worthScore,
    action,
    legalReviewRequired: outcome.legalReviewRequired,
    compliance: outcome.compliance ?? undefined,
    error: outcome.error,
  };
}

/** Keywords already in flight (so we never re-draft the same topic). */
async function loadInflightKeywords(
  db: ReturnType<typeof getTenantJobDb>,
): Promise<Set<string>> {
  const { data } = await db
    .select("content_pipeline", "keywords")
    .in("status", ["brief", "draft", "review", "needs_legal", "approved", "published"]);
  const set = new Set<string>();
  for (const row of (data ?? []) as unknown as { keywords: string | null }[]) {
    if (row.keywords) set.add(row.keywords.trim().toLowerCase());
  }
  return set;
}

function buildSummary(args: {
  dryRun: boolean;
  produced: AgentItemResult[];
  held: AgentItemResult[];
  skipped: AgentItemResult[];
  considered: number;
}): string {
  if (args.dryRun) {
    return `Dry run: would draft ${args.produced.length} of ${args.considered} considered opportunities (${args.skipped.length} skipped). No drafts written.`;
  }
  const queued = args.produced.filter(
    (p) => p.action === "queued_for_review",
  ).length;
  const errored = args.produced.filter((p) => p.action === "error").length;
  return (
    `Drafted ${queued} item(s) awaiting approval, held ${args.held.length} for legal review, ` +
    `skipped ${args.skipped.length}` +
    (errored ? `, ${errored} error(s)` : "") +
    `. The agent published nothing — review and approve in the inbox.`
  );
}
