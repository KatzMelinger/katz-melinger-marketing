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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApproveBody = {
  type?: "content" | "onpage";
  id?: string;
  action?: "approve" | "reject";
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
  return approveContent(supabase, tenantId, id, action);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

async function approveContent(
  supabase: any,
  tenantId: string,
  id: string,
  action: "approve" | "reject",
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
