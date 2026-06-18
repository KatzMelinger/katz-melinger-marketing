/**
 * Draft one topic and route it into the human approval queue.
 *
 * This is the shared draft → analyze → compliance-gate → persist path used by
 * BOTH the autonomous content agent (cron) and Peggy's chat `create_content_draft`
 * tool. Keeping it in one place guarantees chat-created and agent-created content
 * pass through the SAME attorney-advertising hard gate.
 *
 * Where a PASSING draft lands is caller-controlled via `landingStatus`:
 *   - 'review' (default) → Content Production "Approve" column (cron agent).
 *   - 'draft'            → "Draft" column, so a human reads it before Approve
 *                          (Peggy chat — same review path as every other source).
 * A HOLD always wins regardless: a compliance/legal failure forces 'needs_legal'.
 *
 * Outcome:
 *   - PASS → content_drafts.status = landingStatus ('review' | 'draft')
 *   - HOLD → content_drafts.status = 'needs_legal' (held; never auto-surfaced)
 *
 * The compliance gate ALSO re-runs at the approve step, so a draft landing in
 * 'draft' is never published without passing the gate. It NEVER publishes here —
 * it always stops before the approval gate.
 */

import { getTenantJobDb } from "@/lib/tenant-db";
import { generateMultiFormat, type FormatKey } from "@/lib/content-multiformat";
import { analyzeDraft } from "@/lib/content-analysis";
import { runComplianceGate, surfaceForFormat } from "@/lib/agent/compliance-filter";

export type ComplianceSummary = {
  pass: boolean;
  status: string;
  score: number;
  highSeverityCount: number;
  violations: { rule: string; severity: string; reason: string }[];
  suggestedRewrite: string;
};

export type DraftGateOutcome = {
  draftId: string | null;
  batchId: string | null;
  title: string | null;
  format: FormatKey;
  status: "review" | "draft" | "needs_legal";
  pass: boolean;
  legalReviewRequired: boolean;
  compliance: ComplianceSummary | null;
  error?: string;
};

/**
 * Generate a draft for `topic`, analyze it, run the compliance hard gate, and
 * persist it (content_drafts status + a mirrored content_pipeline row) so it
 * shows up on the Content Production board awaiting approval.
 */
export async function draftTopicToReview(args: {
  tenantId: string;
  topic: string;
  practiceArea?: string | null;
  /** Defaults to a long-form blog post. */
  format?: FormatKey;
  targetKeywords?: string[];
  seoBriefHeadings?: string[];
  /** Compliance gate threshold (0-100). */
  minComplianceScore?: number;
  /**
   * Where a PASSING draft lands. 'review' (default) drops it straight into the
   * Approve column (autonomous cron agent). 'draft' lands it in the Draft column
   * so a human reviews it first (Peggy chat). A HOLD always overrides to
   * 'needs_legal'.
   */
  landingStatus?: "review" | "draft";
  /** Tagged on the draft + pipeline row so we know where it came from. */
  originSource?: string;
  runId?: string | null;
  packetId?: string | null;
  /** An independent hold reason (e.g. research flagged legal review). */
  legalReviewRequired?: boolean;
  /** Pipeline note prefix; the compliance score is appended automatically. */
  notePrefix?: string;
  pipelineBucket?: string;
  /** Reuse an existing tenant-stamped db handle (the cron agent passes its own). */
  db?: ReturnType<typeof getTenantJobDb>;
}): Promise<DraftGateOutcome> {
  const tenantId = args.tenantId;
  const db = args.db ?? getTenantJobDb(tenantId);
  const format: FormatKey = args.format ?? "blog";
  const originSource = args.originSource ?? "agent";

  // 1. Draft — generateMultiFormat persists the draft (at its default
  // 'initial_review' status, which we override below) stamped to this tenant.
  const batch = await generateMultiFormat({
    topic: args.topic,
    practiceArea: args.practiceArea ?? undefined,
    formats: [format],
    targetKeywords: args.targetKeywords,
    seoBriefHeadings: args.seoBriefHeadings,
    tenantId,
    originSource,
    originContext: { run_id: args.runId ?? null, packet_id: args.packetId ?? null },
  });

  const draft = batch.drafts.find((d) => d.format === format);
  if (!draft) {
    return {
      draftId: null,
      batchId: batch.batch_id,
      title: null,
      format,
      status: "needs_legal",
      pass: false,
      legalReviewRequired: args.legalReviewRequired === true,
      compliance: null,
      error: `Generation returned no ${format} draft`,
    };
  }

  // 2. Analyze — full scorecard (persists to content_analyses internally).
  // Non-fatal: a scorecard failure must not block the compliance gate.
  try {
    await analyzeDraft({
      draftId: draft.id,
      body: draft.body,
      targetKeywords: args.targetKeywords ?? [],
      title: draft.title,
      topic: args.topic,
      format,
      practiceArea: args.practiceArea,
    });
  } catch (err) {
    console.warn(
      `[draft-to-review] analyze failed for draft ${draft.id}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 3. Compliance HARD GATE.
  const verdict = await runComplianceGate({
    content: draft.body,
    surface: surfaceForFormat(format),
    practiceArea: args.practiceArea ?? undefined,
    minScore: args.minComplianceScore,
  });

  const legalReviewRequired = args.legalReviewRequired === true;
  const pass = verdict.pass && !legalReviewRequired;
  // A passing draft lands wherever the caller asked (Approve vs Draft column);
  // a hold always forces needs_legal.
  const landingStatus = args.landingStatus ?? "review";
  const newStatus: "review" | "draft" | "needs_legal" = pass
    ? landingStatus
    : "needs_legal";

  const complianceSummary: ComplianceSummary = {
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

  // 4. Persist status + audit metadata on the draft. Merge onto the metadata the
  // generator already wrote so we don't clobber origin_source / model.
  const mergedMetadata = {
    ...(draft.metadata ?? {}),
    source: originSource,
    run_id: args.runId ?? null,
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
      draftId: draft.id,
      batchId: batch.batch_id,
      title: draft.title,
      format,
      status: newStatus,
      pass: false,
      legalReviewRequired,
      compliance: complianceSummary,
      error: `Failed to set draft status: ${updErr.message}`,
    };
  }

  // 5. Mirror into the editorial pipeline so the work shows on the board and the
  // agent's idempotency check sees it next run. Fresh draft_id ⇒ a plain insert.
  const note =
    `${args.notePrefix ?? "Created by agent"} · compliance ${verdict.score}`;
  await db.insert("content_pipeline", {
    title: draft.title ?? args.topic,
    keywords: args.topic,
    status: newStatus,
    bucket: args.pipelineBucket ?? "bofu_education",
    draft_id: draft.id,
    notes: note,
  });

  return {
    draftId: draft.id,
    batchId: batch.batch_id,
    title: draft.title,
    format,
    status: newStatus,
    pass,
    legalReviewRequired,
    compliance: complianceSummary,
  };
}
