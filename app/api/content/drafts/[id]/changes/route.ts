/**
 * GET  /api/content/drafts/[id]/changes  — the "Changes made" log
 * POST /api/content/drafts/[id]/changes
 *   { action: "undo", changeId }  undo one change; every other change stays
 *   { action: "review" }          mark the log reviewed (unblocks Approve)
 *
 * Diana's Sept 28 spec, section 9. Identity comes from the session, so a
 * review cannot be attributed to someone else.
 */
import { NextRequest, NextResponse } from "next/server";

import { getTenantClient } from "@/lib/tenant-db";
import { getCurrentUser } from "@/lib/supabase-route";
import { readFixLog, undoChange, unreviewedChanges } from "@/lib/legal-fix-log";
import { clearTextCertifications } from "@/lib/draft-certifications";
import { recordAuditEvent } from "@/lib/content-findings-store";
import { scheduleDraftAnalysis } from "@/lib/auto-analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase.from("content_drafts").select("metadata").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const log = readFixLog(data.metadata as Record<string, unknown> | null);
  return NextResponse.json({ log, unreviewed: unreviewedChanges(log).length });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const input = (await req.json().catch(() => ({}))) as { action?: string; changeId?: string };
  const { supabase, tenantId } = await getTenantClient();

  const { data: draft, error } = await supabase
    .from("content_drafts")
    .select("id, title, body, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const meta = (draft.metadata as Record<string, unknown> | null) ?? {};
  const log = readFixLog(meta);
  const now = new Date().toISOString();

  if (input.action === "review") {
    const next = { ...log, reviewed_by: user.email, reviewed_at: now };
    const { error: upd } = await supabase
      .from("content_drafts")
      .update({ metadata: { ...meta, legal_fix_log: next } })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (upd) return NextResponse.json({ error: upd.message }, { status: 500 });
    await recordAuditEvent({
      tenantId,
      draftId: id,
      event: "changes_reviewed",
      actorUserId: user.id,
      actorEmail: user.email,
      detail: { changes: log.changes.filter((c) => !c.undone_at).length },
    });
    return NextResponse.json({ log: next, unreviewed: 0 });
  }

  if (input.action === "undo") {
    const change = log.changes.find((c) => c.id === input.changeId);
    if (!change) return NextResponse.json({ error: "Unknown change" }, { status: 404 });
    if (change.undone_at) return NextResponse.json({ error: "Already undone" }, { status: 409 });
    const res = undoChange((draft.body as string | null) ?? "", (draft.title as string | null) ?? null, change);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });

    const changes = log.changes.map((c) => (c.id === change.id ? { ...c, undone_at: now, undone_by: user.email } : c));
    const nextMeta = clearTextCertifications({ ...meta, legal_fix_log: { ...log, changes } }).meta;
    const { error: upd } = await supabase
      .from("content_drafts")
      .update({ body: res.body, title: res.title, metadata: nextMeta, updated_at: now })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (upd) return NextResponse.json({ error: upd.message }, { status: 500 });
    await recordAuditEvent({
      tenantId,
      draftId: id,
      event: "change_undone",
      actorUserId: user.id,
      actorEmail: user.email,
      detail: { change: change.id, reason: change.reason, source: change.source },
    });
    scheduleDraftAnalysis({ draftId: id, body: res.body, title: res.title });
    const nextLog = readFixLog(nextMeta);
    return NextResponse.json({ log: nextLog, unreviewed: unreviewedChanges(nextLog).length, body: res.body, title: res.title });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
