/**
 * GET   /api/content/drafts/[id]/findings   — tracked findings + audit trail
 * PATCH /api/content/drafts/[id]/findings   — move one finding's status
 *          body: { findingId, status, note? }
 *
 * The durable half of the QA loop. Findings arrive here from every check via
 * analyzeDraft, keep their identity across re-runs, and carry who resolved them
 * and when. Each transition is written to the audit log, so "who closed this,
 * and did the check agree" has an answer.
 */

import { NextRequest, NextResponse } from "next/server";

import { isFindingStatus } from "@/lib/content-findings";
import {
  listAuditEvents,
  listFindings,
  recordAuditEvent,
  setFindingStatus,
} from "@/lib/content-findings-store";
import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;

  // Ownership check through the RLS-scoped client: a draft from another tenant
  // reads as missing, so findings cannot be enumerated across tenants.
  const { supabase } = await getTenantClient();
  const { data: draft } = await supabase
    .from("content_drafts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [findings, audit] = await Promise.all([listFindings(id), listAuditEvents(id)]);
  return NextResponse.json({ findings, audit });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    findingId?: unknown;
    status?: unknown;
    note?: unknown;
  };
  const findingId = typeof body.findingId === "string" ? body.findingId : "";
  if (!findingId) return NextResponse.json({ error: "findingId is required" }, { status: 400 });
  if (!isFindingStatus(body.status)) {
    return NextResponse.json(
      { error: "status must be one of: open, in_progress, resolved, dismissed" },
      { status: 400 },
    );
  }
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined;

  const { supabase, tenantId } = await getTenantClient();
  const { data: draft } = await supabase
    .from("content_drafts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Dismissing is the one transition that makes a finding stop coming back —
  // reconcileFindings leaves a dismissed finding dismissed on every future run.
  // Requiring a reason keeps that from becoming a silent way to clear the board.
  if (body.status === "dismissed" && !note) {
    return NextResponse.json(
      { error: "Dismissing a finding requires a reason — it will not be raised again." },
      { status: 400 },
    );
  }

  const updated = await setFindingStatus({
    findingId,
    tenantId,
    status: body.status,
    userId: user.id,
    userEmail: user.email,
    note,
  });
  if (!updated) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  await recordAuditEvent({
    tenantId,
    draftId: id,
    event: `finding_${body.status}`,
    actorUserId: user.id,
    actorEmail: user.email,
    detail: {
      findingId,
      source: updated.source,
      ruleId: updated.ruleId,
      severity: updated.severity,
      title: updated.title,
      note: note ?? null,
    },
  });

  const findings = await listFindings(id);
  return NextResponse.json({ finding: updated, findings });
}
