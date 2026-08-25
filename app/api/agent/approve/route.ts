/**
 * POST /api/agent/approve
 *   body (content): { type: "content", id: <content_drafts.id>, action?: "approve" | "reject" }
 *   body (on-page): { type: "onpage",  id: <wp_autopilot_recommendations.id>, action?: "approve" | "reject" }
 *
 * The single human approval gate for agent-produced work. Flipping an item to
 * `approved` is the ONLY thing that unlocks the downstream publish paths:
 *   - on-page/SEO fixes → the WordPress AutoPilot plugin polls ?status=approved
 *   - content drafts     → (publish wiring is a later pass; Ayrshare/WP)
 *
 * Guardrails:
 *   - A `needs_legal` item (held by the compliance hard gate) CANNOT be
 *     approved — it must be edited to compliance first (422 with violations).
 *   - Tenant isolation is enforced by RLS via the request-scoped client.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import {
  runComplianceGate,
  surfaceForFormat,
} from "@/lib/agent/compliance-filter";
import { findTimeSensitiveFacts } from "@/lib/freshness-check";
import { classifyFreshness, outstandingFreshness } from "@/lib/freshness-classify";
import { getCurrentFacts } from "@/lib/current-facts-store";
import { freshnessGateEnabled } from "@/lib/feature-flags";
import { logEvent } from "@/lib/telemetry";
import { analysisStaleness, type AnalysisFingerprint } from "@/lib/analysis-fingerprint";
import { recordAuditEvent } from "@/lib/content-findings-store";
import { notifyDraftBlocked } from "@/lib/content-notifications";
import { getCurrentUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApproveBody = {
  type?: "content" | "onpage";
  id?: string;
  action?: "approve" | "reject";
  /** Reviewer confirmations of "verify" figures (freshness gate), by flag key. */
  freshnessVerifiedKeys?: string[];
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ApproveBody;
  const id = typeof body?.id === "string" ? body.id : "";
  const type = body?.type === "onpage" ? "onpage" : "content";
  const action = body?.action === "reject" ? "reject" : "approve";

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { supabase, tenantId } = await getTenantClient();

  if (type === "onpage") {
    return approveOnPage(supabase, tenantId, id, action);
  }
  const verifiedKeys = new Set(
    Array.isArray(body?.freshnessVerifiedKeys)
      ? body.freshnessVerifiedKeys.filter((k): k is string => typeof k === "string")
      : [],
  );
  return approveContent(supabase, tenantId, id, action, verifiedKeys);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

async function approveContent(
  supabase: any,
  tenantId: string,
  id: string,
  action: "approve" | "reject",
  verifiedKeys: Set<string> = new Set(),
) {
  // RLS scopes this read to the caller's tenant — a cross-tenant id returns null.
  const { data: draft, error } = await supabase
    .from("content_drafts")
    .select("id, status, body, format, practice_area, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "reject") {
    await setDraftStatus(supabase, tenantId, id, "archived");
    return NextResponse.json({ id, status: "archived" });
  }

  // The compliance hard gate: a held item cannot be approved as-is.
  if (draft.status === "needs_legal") {
    const compliance = (draft.metadata as { compliance?: unknown } | null)
      ?.compliance;
    return NextResponse.json(
      {
        error:
          "This item was held by the compliance gate and cannot be approved until it is edited to compliance.",
        status: "needs_legal",
        compliance,
      },
      { status: 422 },
    );
  }

  if (draft.status !== "review") {
    return NextResponse.json(
      { error: `Only items awaiting review can be approved (status: ${draft.status}).` },
      { status: 409 },
    );
  }

  // A stale analysis cannot satisfy the QA gate. Recomputing is asynchronous
  // and never blocks editing — approval is the one place that has to insist on
  // a current measurement, because it is the last point where a wrong number is
  // still cheap to fix. Covers all three ways a score goes stale: the body was
  // edited since scoring, the scoring engine changed underneath it, or the row
  // predates fingerprinting and its provenance is simply unknown.
  {
    const currentBody = typeof draft.body === "string" ? draft.body : "";
    const { data: analyses, error: analysisError } = await supabase
      .from("content_analyses")
      .select("scored_against")
      .eq("draft_id", id)
      .order("created_at", { ascending: false })
      .limit(1);
    // Before supabase/content_analyses_fingerprint.sql is run the column does
    // not exist and this errors. That case fails OPEN deliberately: the gate is
    // inert until the migration lands, rather than blocking every approval in
    // the app on a migration nobody has run yet. It is logged so an unrelated
    // query failure does not disable the gate quietly.
    if (analysisError) {
      console.warn("[approve] staleness check skipped:", analysisError.message);
    }
    const latest = analyses?.[0] as { scored_against?: AnalysisFingerprint | null } | undefined;
    // No analysis at all stays advisory (matches the existing QA behavior —
    // an unscored draft is not retroactively blocked). A PRESENT but stale one
    // blocks, because it is actively showing a number that is not true.
    if (latest) {
      const staleness = analysisStaleness(latest.scored_against, currentBody);
      if (staleness.stale) {
        logEvent("approve_blocked_stale_analysis", { draftId: id, reason: staleness.reason });
        return NextResponse.json(
          {
            error: `${staleness.message} The draft was not approved.`,
            staleness,
          },
          { status: 409 },
        );
      }
    }
  }

  // Freshness HARD gate (feature-flagged). Recompute time-sensitive figures from
  // the CURRENT body and hold the draft for legal if any is unresolved. Outdated
  // is body-derived, so a stale value still in the draft can't be waved through —
  // the reviewer must apply the current value or mark a "verify" figure verified.
  // Server-authoritative: a direct API call can't bypass it the way a client can.
  if (freshnessGateEnabled()) {
    const body = typeof draft.body === "string" ? draft.body : "";
    const facts = await getCurrentFacts(tenantId);
    const flags = classifyFreshness(findTimeSensitiveFacts(body), facts);
    const outstanding = outstandingFreshness(flags, verifiedKeys);
    if (outstanding.length > 0) {
      const freshness = {
        checked_at: new Date().toISOString(),
        outstanding: outstanding.map((f) => ({
          match: f.match,
          status: f.status,
          reason: f.reason,
          suggested_value: f.suggested_value,
          current_label: f.current_label,
        })),
      };
      const mergedMetadata = {
        ...((draft.metadata as Record<string, unknown> | null) ?? {}),
        freshness_gate: freshness,
      };
      await supabase
        .from("content_drafts")
        .update({ status: "needs_legal", metadata: mergedMetadata })
        .eq("id", id)
        .eq("tenant_id", tenantId);
      await supabase
        .from("content_pipeline")
        .update({ status: "needs_legal" })
        .eq("draft_id", id)
        .eq("tenant_id", tenantId);
      logEvent("freshness_gate_hold", {
        draftId: id,
        outstanding: outstanding.length,
        outdated: outstanding.filter((f) => f.status === "outdated").length,
        verify: outstanding.filter((f) => f.status === "verify").length,
      });
      await recordAuditEvent({
        tenantId,
        draftId: id,
        event: "draft_held_freshness",
        detail: { outstanding: outstanding.length },
      });
      await notifyDraftBlocked({
        draftId: id,
        tenantId,
        reason: "freshness",
        detail: `${outstanding.length} time-sensitive figure${
          outstanding.length === 1 ? "" : "s"
        } need resolving: ${outstanding.map((f) => f.match).slice(0, 5).join(", ")}`,
      });
      return NextResponse.json(
        {
          error: "Held for legal — resolve the time-sensitive figures before approving.",
          status: "needs_legal",
          freshness,
        },
        { status: 422 },
      );
    }
    logEvent("freshness_gate_pass", {
      draftId: id,
      flags: flags.length,
      verified: verifiedKeys.size,
    });
  }

  // Re-run the compliance HARD gate on the CURRENT body. Manual approvals are
  // gated exactly like the agent's auto-path, fail-closed to needs_legal — so a
  // reviewer can't sign off on content the gate would have held (and edits made
  // since drafting are re-checked). The gate throwing = treat as held.
  let verdict;
  try {
    verdict = await runComplianceGate({
      content: typeof draft.body === "string" ? draft.body : "",
      surface: surfaceForFormat((draft.format as string | null) ?? "blog"),
      practiceArea: (draft.practice_area as string | null) ?? undefined,
    });
  } catch {
    verdict = null;
  }

  if (!verdict || !verdict.pass) {
    const compliance = verdict
      ? {
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
        }
      : { pass: false, status: "non_compliant", score: 0, error: "compliance check failed" };

    const mergedMetadata = {
      ...((draft.metadata as Record<string, unknown> | null) ?? {}),
      compliance,
    };
    await supabase
      .from("content_drafts")
      .update({ status: "needs_legal", metadata: mergedMetadata })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    await supabase
      .from("content_pipeline")
      .update({ status: "needs_legal" })
      .eq("draft_id", id)
      .eq("tenant_id", tenantId);

    await recordAuditEvent({
      tenantId,
      draftId: id,
      event: "draft_held_compliance",
      detail: {
        score: compliance.score,
        status: compliance.status,
        violations: verdict?.violations.length ?? 0,
      },
    });
    await notifyDraftBlocked({
      draftId: id,
      tenantId,
      reason: "compliance",
      detail: verdict
        ? `${verdict.violations.length} violation${
            verdict.violations.length === 1 ? "" : "s"
          }: ${verdict.violations.map((v) => v.reason).slice(0, 5).join("; ")}`
        : "The compliance check could not run, so the draft was held.",
    });
    return NextResponse.json(
      {
        error:
          "Held by the compliance gate — edit the draft to compliance before approving.",
        status: "needs_legal",
        compliance,
      },
      { status: 422 },
    );
  }

  await setDraftStatus(supabase, tenantId, id, "approved");
  // Who approved this, and what the checks said at the time. Approval was the
  // one action with no durable record of either.
  const approver = await getCurrentUser();
  await recordAuditEvent({
    tenantId,
    draftId: id,
    event: "draft_approved",
    actorUserId: approver?.id ?? null,
    actorEmail: approver?.email ?? null,
    detail: {
      compliance_score: verdict.score,
      compliance_status: verdict.status,
      freshness_gate: freshnessGateEnabled() ? "enforced" : "off",
      freshness_verified_keys: Array.from(verifiedKeys),
    },
  });
  return NextResponse.json({ id, status: "approved" });
}

async function setDraftStatus(
  supabase: any,
  tenantId: string,
  draftId: string,
  status: string,
) {
  await supabase
    .from("content_drafts")
    .update({ status })
    .eq("id", draftId)
    .eq("tenant_id", tenantId);
  // Keep the linked editorial-pipeline row in lockstep.
  await supabase
    .from("content_pipeline")
    .update({ status })
    .eq("draft_id", draftId)
    .eq("tenant_id", tenantId);
}

async function approveOnPage(
  supabase: any,
  tenantId: string,
  id: string,
  action: "approve" | "reject",
) {
  const { data: rec, error } = await supabase
    .from("wp_autopilot_recommendations")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "reject") {
    await supabase
      .from("wp_autopilot_recommendations")
      .update({ status: "rejected" })
      .eq("id", id);
    return NextResponse.json({ id, status: "rejected" });
  }

  if (rec.status !== "pending") {
    return NextResponse.json(
      { error: `Only pending fixes can be approved (status: ${rec.status}).` },
      { status: 409 },
    );
  }

  await supabase
    .from("wp_autopilot_recommendations")
    .update({ status: "approved" })
    .eq("id", id);
  return NextResponse.json({ id, status: "approved" });
}
