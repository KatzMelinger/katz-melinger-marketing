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
import { freshnessGateEnabled, legalAccuracyEnabled } from "@/lib/feature-flags";
import { logEvent } from "@/lib/telemetry";
import { analysisStaleness, type AnalysisFingerprint } from "@/lib/analysis-fingerprint";
import { recordAuditEvent } from "@/lib/content-findings-store";
import { notifyDraftBlocked, notifyLegalReview } from "@/lib/content-notifications";
import { runLegalCheck } from "@/lib/legal-verify";
import { runTrapCheck } from "@/lib/trap-gate";
import { runKbChecks } from "@/lib/legal-kb";
import { checkBlogCannibalization } from "@/lib/blog-cannibalization";
import { checkSocialCompliance } from "@/lib/social-compliance";
import { getOperatingBrief } from "@/lib/social-operating-brief";
import { syncFindings } from "@/lib/content-findings-store";
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
    .select("id, status, body, title, topic, format, practice_area, metadata, seo_brief")
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
        // Overwritten on every hold attempt so the drawer always shows the
        // CURRENT reason, not a stale one left over from an earlier gate that
        // has since been fixed (metadata otherwise only ever grows).
        held_reason: "freshness",
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

  // The DETERMINISTIC floor, ahead of the LLM verdict below.
  //
  // These are the same rules the social gate has always run — brand and RPC
  // patterns plus the phone-number check — now run on blog and page bodies too
  // (Diana's item 6). It is what would have caught the wrong office number
  // appearing four times in the Unpaid Wages blog: the rule existed, it just
  // only ever saw captions.
  //
  // Rules declare their own scope, so the social-only ones do not cross over.
  // `state_abbrev` in particular must not: it forbids "NYC", which is right for
  // a caption and wrong for a blog targeting "unpaid wages lawyer NYC".
  //
  // Runs first because it is free and certain. A body carrying the wrong phone
  // number does not need a model's opinion, and a definite answer should not
  // wait behind an expensive uncertain one.
  const copyBrief = await getOperatingBrief(tenantId);
  const copyFlags = checkSocialCompliance(
    typeof draft.body === "string" ? draft.body : "",
    { assetType: "document", documentPhone: copyBrief.documentPhone },
  ).filter((f) => f.severity === "block");

  if (copyFlags.length > 0) {
    await setDraftStatus(supabase, tenantId, id, "needs_legal");
    await recordAuditEvent({
      tenantId,
      draftId: id,
      event: "draft_held_compliance",
      detail: { deterministic: copyFlags.map((f) => f.code) },
    });
    return NextResponse.json(
      {
        error: `Held by the copy rules — ${copyFlags.map((f) => f.label).join("; ")}`,
        status: "needs_legal",
        compliance: {
          pass: false,
          status: "non_compliant",
          violations: copyFlags.map((f) => ({
            rule: f.code,
            severity: "high",
            reason: f.label,
            excerpt: f.excerpt,
          })),
        },
      },
      { status: 422 },
    );
  }

  // Re-run the compliance HARD gate on the CURRENT body. Manual approvals are
  // gated exactly like the agent's auto-path, fail-closed to needs_legal — so a
  // reviewer can't sign off on content the gate would have held (and edits made
  // since drafting are re-checked). The gate throwing = treat as held.
  //
  // Scoped to legal blogs and service pages (spec item 11) — the firm's
  // Attorney Advertising label/disclaimer requirement is a hard block only for
  // those two surfaces. Other content types that reach this same endpoint
  // (e.g. an email newsletter draft) still get the identical check and its
  // violations are recorded for visibility, but a failing verdict there does
  // not hold the draft — it stays advisory, same as the scorecard already
  // shows during editing.
  const surface = surfaceForFormat((draft.format as string | null) ?? "blog");
  const complianceGateApplies = surface === "blog" || surface === "webpage";
  let verdict;
  try {
    verdict = await runComplianceGate({
      content: typeof draft.body === "string" ? draft.body : "",
      surface,
      practiceArea: (draft.practice_area as string | null) ?? undefined,
    });
  } catch {
    verdict = null;
  }

  if (complianceGateApplies && (!verdict || !verdict.pass)) {
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
      held_reason: "compliance",
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

  // ITEM 17 — cannibalization, as a GATE rather than a note.
  //
  // The panel said "Cannibalization: Not checked" on every blog, and the code
  // agreed: it was a checkbox a reviewer ticked, and `unchecked` is advisory by
  // definition. So a blog could be written against the same Google query as a
  // live service page and nothing would say so.
  //
  // Only blogs are gated. A service page is ALLOWED to own its commercial term
  // — that is the arrangement being protected, not a violation of it.
  {
    const format = ((draft.format as string | null) ?? "blog").toLowerCase();
    const isBlog = format === "blog" || format === "blog_post";
    if (isBlog) {
      const brief = (draft.seo_brief as { targetKeywords?: unknown } | null) ?? null;
      const targetKeywords = Array.isArray(brief?.targetKeywords)
        ? (brief.targetKeywords as unknown[]).filter((k): k is string => typeof k === "string")
        : [];

      const cannibal = await checkBlogCannibalization({
        targetKeywords,
        title: (draft.title as string | null) ?? (draft.topic as string | null) ?? null,
      });

      // Scoped to `seo` so this does not disturb the other engines' findings.
      if (cannibal.status !== "unchecked") {
        await syncFindings({
          draftId: id,
          tenantId,
          incoming: cannibal.findings,
          sources: ["seo"],
        });
      }

      logEvent("cannibalization_check", {
        draftId: id,
        status: cannibal.status,
        conflicts: cannibal.conflicts.length,
        pagesScanned: cannibal.pagesScanned,
      });

      if (cannibal.status === "conflict") {
        await setDraftStatus(supabase, tenantId, id, "review");
        // Record WHICH gate held this, so the pipeline can say
        // "cannibalization" rather than always reporting "compliance".
        await supabase
          .from("content_drafts")
          .update({
            metadata: {
              ...((draft.metadata as Record<string, unknown> | null) ?? {}),
              held_reason: "cannibalization",
              cannibalization_conflict: { conflicts: cannibal.conflicts },
            },
          })
          .eq("id", id)
          .eq("tenant_id", tenantId);
        await recordAuditEvent({
          tenantId,
          draftId: id,
          event: "draft_held_cannibalization",
          detail: { conflicts: cannibal.conflicts.map((c) => ({ url: c.url, keyword: c.keyword })) },
        });
        await notifyDraftBlocked({
          draftId: id,
          tenantId,
          reason: "cannibalization",
          detail: cannibal.conflicts
            .slice(0, 5)
            .map((c) => `"${c.keyword}" is already targeted by ${c.title} (${c.url}).`)
            .join(" "),
        });
        return NextResponse.json(
          {
            error: `Held — ${cannibal.conflicts.length} keyword${
              cannibal.conflicts.length === 1 ? "" : "s"
            } already targeted by a live page. Reposition this draft to informational intent and link the owning page.`,
            status: "review",
            cannibalization: {
              status: cannibal.status,
              conflicts: cannibal.conflicts,
            },
          },
          { status: 422 },
        );
      }
    }
  }

  // THE LEGAL LAYER (Diana's A1). Two producers, one gate, run last because the
  // second of them is the most expensive check in the pipeline.
  //
  // Known traps are a text search over patterns that have already been wrong
  // once (lib/trap-gate.ts). No model call, no retrieval, so they are NOT
  // feature-flagged — they run on every approval and cost nothing to leave on.
  // This is the half that catches the seeded errors, including the ones that
  // cite no authority and so were invisible to the loop below.
  //
  // The authority loop (runLegalCheck) is a classification call plus a
  // retrieval and up to two verification calls per checkable claim, each
  // carrying statute text. It stays behind LEGAL_ACCURACY. Running it at
  // approval rather than on save is Diana's Q3 answer — the blocking point is
  // approval, not editing, and a draft nobody kept is not worth verifying.
  //
  // Findings are synced whatever the verdict, so the reviewer sees the whole
  // picture: what was verified, what was contradicted, and what no lookup could
  // settle. Only a CRITICAL finding holds the draft.
  {
    const body = typeof draft.body === "string" ? draft.body : "";

    const traps = await runTrapCheck(body, { tenantId });
    if (traps.failed) {
      // Same rule as a failed authority check: a checker that could not run is
      // not a clean bill of health.
      return NextResponse.json(
        {
          error:
            "The known-traps check could not run, so this was not approved. Try again, or have an attorney clear it manually.",
          status: draft.status,
        },
        { status: 503 },
      );
    }

    // Stage 2 of item 11 — the knowledge base. Deterministic like the traps,
    // so it runs unflagged: every check is a lookup against a row an attorney
    // can read, not a model call. Traps catch what has been wrong BEFORE; the
    // base catches what is wrong against what is right, which is how the
    // Article 6 citation gets caught the first time anyone writes it.
    const kb = await runKbChecks(body, { tenantId });
    if (kb.failed) {
      return NextResponse.json(
        {
          error:
            "The legal knowledge base could not be read, so this was not approved. Try again, or have an attorney clear it manually.",
          status: draft.status,
        },
        { status: 503 },
      );
    }

    let findings = [...traps.findings, ...kb.findings];
    let legalStats: Record<string, number> | null = null;

    if (legalAccuracyEnabled()) {
      try {
        const legal = await runLegalCheck(body, { tenantId });
        // Merged, not synced separately: both write under source `legal`, and
        // a scoped sync auto-resolves anything in that source it was not
        // handed — so two calls would each close the other's findings.
        findings = [...legal.findings, ...traps.findings, ...kb.findings];
        legalStats = legal.stats;
      } catch (e) {
        // The legal check failing must not silently approve. Hold the draft and
        // say why — an unavailable checker is not a clean bill of health.
        console.warn("[approve] legal check failed:", e);
        return NextResponse.json(
          {
            error:
              "The legal-accuracy check could not run, so this was not approved. Try again, or have an attorney clear it manually.",
            status: draft.status,
          },
          { status: 503 },
        );
      }
    }

    // Scoped to `legal` so this partial run cannot auto-resolve the
    // readability, SEO, freshness and compliance findings it never looked for.
    await syncFindings({ draftId: id, tenantId, incoming: findings, sources: ["legal"] });

    const critical = findings.filter((f) => f.severity === "critical");
    logEvent("legal_check", {
      draftId: id,
      ...(legalStats ?? {}),
      traps: traps.findings.length,
      kb: kb.findings.length,
      kbEntries: kb.stats.entries,
      kbApplied: kb.stats.applied,
      authorityLoop: legalAccuracyEnabled() ? "on" : "off",
      critical: critical.length,
    });

    if (critical.length > 0) {
      const summary = critical
        .slice(0, 5)
        .map((f) => `- ${f.title}: "${(f.excerpt ?? "").slice(0, 120)}"`)
        .join("\n");
      const legalHold = {
        stats: legalStats,
        critical: critical.map((c) => ({
          title: c.title,
          excerpt: c.excerpt,
          source: c.sourceChecked,
        })),
      };
      await supabase
        .from("content_drafts")
        .update({
          status: "needs_legal",
          metadata: {
            ...((draft.metadata as Record<string, unknown> | null) ?? {}),
            held_reason: "legal",
            legal_hold: legalHold,
          },
        })
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
        event: "draft_held_legal",
        detail: { critical: critical.length, traps: traps.findings.length, ...(legalStats ?? {}) },
      });
      await notifyLegalReview({
        draftId: id,
        tenantId,
        practiceArea: (draft.practice_area as string | null) ?? null,
        topic: (draft.topic as string | null) ?? null,
        title: (draft.title as string | null) ?? null,
        criticalCount: critical.length,
        summary,
      });
      return NextResponse.json(
        {
          error: `Held for legal review — ${critical.length} claim(s) need an attorney before this can publish.`,
          status: "needs_legal",
          legal: legalHold,
        },
        { status: 422 },
      );
    }
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
      // verdict can be null here now that the gate is scoped off some
      // surfaces (spec item 11) — a non-blog/webpage draft whose compliance
      // check itself failed still reaches approval, with no verdict to report.
      compliance_score: verdict?.score ?? null,
      compliance_status: verdict?.status ?? null,
      compliance_gate_applied: complianceGateApplies,
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
