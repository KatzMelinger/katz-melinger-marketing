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
import { generateMultiFormat } from "@/lib/content-multiformat";
import { analyzeDraft } from "@/lib/content-analysis";
import { runComplianceGate, surfaceForFormat } from "@/lib/agent/compliance-filter";

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

  // 2. Draft — long-form blog article for this opportunity. generateMultiFormat
  // accepts an explicit tenantId for background contexts and persists the draft
  // (at the default 'initial_review' status, which we override below).
  const batch = await generateMultiFormat({
    topic: winner.keyword,
    practiceArea: args.practiceArea ?? undefined,
    formats: ["blog"],
    targetKeywords: winner.brief?.targetKeywords,
    seoBriefHeadings: winner.brief?.headings,
    tenantId,
    originSource: "agent",
    originContext: { run_id: runId, packet_id: winner.packetId ?? null },
  });

  const draft = batch.drafts.find((d) => d.format === "blog");
  if (!draft) {
    return {
      keyword: winner.keyword,
      draftId: null,
      batchId: batch.batch_id,
      worthScore: winner.worthScore,
      action: "error",
      error: "Generation returned no blog draft",
    };
  }

  // 3. Analyze — full scorecard (persists to content_analyses internally).
  // Non-fatal: a scorecard failure must not block the compliance gate.
  try {
    await analyzeDraft({
      draftId: draft.id,
      body: draft.body,
      targetKeywords: winner.brief?.targetKeywords ?? [],
      title: draft.title,
      topic: winner.keyword,
      format: "blog",
      practiceArea: args.practiceArea,
    });
  } catch (err) {
    console.warn(
      `[content-agent] analyze failed for draft ${draft.id}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 4. Compliance HARD GATE.
  const verdict = await runComplianceGate({
    content: draft.body,
    surface: surfaceForFormat("blog"),
    practiceArea: args.practiceArea ?? undefined,
    minScore: args.minComplianceScore,
  });

  // A research-packet legal flag is an independent hold reason.
  const legalReviewRequired = winner.legalReviewRequired === true;
  const pass = verdict.pass && !legalReviewRequired;
  const newStatus = pass ? "review" : "needs_legal";

  const complianceSummary = {
    pass: verdict.pass,
    status: verdict.status,
    score: verdict.score,
    highSeverityCount: verdict.highSeverityCount,
    violations: verdict.violations.map((v) => ({
      rule: v.rule,
      severity: v.severity,
      reason: v.reason,
    })),
    suggestedRewrite: verdict.suggestedRewrite,
  };

  // Persist status + audit metadata on the draft. Merge onto the metadata the
  // generator already wrote so we don't clobber origin_source / model.
  const mergedMetadata = {
    ...(draft.metadata ?? {}),
    source: "agent",
    run_id: runId,
    legal_review_required: legalReviewRequired,
    compliance: complianceSummary,
  };

  const { error: updErr } = await db.raw
    .from("content_drafts")
    .update({ status: newStatus, metadata: mergedMetadata })
    .eq("id", draft.id)
    .eq("tenant_id", tenantId);
  if (updErr) {
    return {
      keyword: winner.keyword,
      draftId: draft.id,
      batchId: batch.batch_id,
      worthScore: winner.worthScore,
      action: "error",
      error: `Failed to set draft status: ${updErr.message}`,
      compliance: complianceSummary,
      legalReviewRequired,
    };
  }

  // Mirror into the editorial pipeline so the work shows on the board and the
  // idempotency check sees it next run. Fresh draft_id ⇒ a plain insert.
  await db.insert("content_pipeline", {
    title: draft.title ?? winner.keyword,
    keywords: winner.keyword,
    status: newStatus,
    bucket: "bofu_education",
    draft_id: draft.id,
    notes: `Autonomous agent · worth ${winner.worthScore} · compliance ${verdict.score}`,
  });

  return {
    keyword: winner.keyword,
    draftId: draft.id,
    batchId: batch.batch_id,
    worthScore: winner.worthScore,
    action: pass ? "queued_for_review" : "held_needs_legal",
    legalReviewRequired,
    compliance: complianceSummary,
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
