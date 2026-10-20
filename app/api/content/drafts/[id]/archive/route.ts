/**
 * POST /api/content/drafts/[id]/archive
 *   { action: "archive", reason: "Duplicate" | "Off practice", duplicateOf?: string }
 *   { action: "restore" }   (archives the kept version in its place, if live)
 *
 * Archive a draft without deleting it, or bring it back (Sept 28 spec,
 * Appendix F). RLS-scoped client, so another tenant's draft is not found.
 */
import { NextRequest, NextResponse } from "next/server";

import { getTenantClient } from "@/lib/tenant-db";
import { getCurrentUser } from "@/lib/supabase-route";
import { archiveDrafts, readArchive, restoreDraft } from "@/lib/draft-archive";
import { recordAuditEvent } from "@/lib/content-findings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const input = (await req.json().catch(() => ({}))) as {
    action?: string;
    reason?: string;
    duplicateOf?: string;
  };
  const { supabase, tenantId } = await getTenantClient();

  if (input.action === "restore") {
    // One live draft per topic (Oct 20 spec, Task A3): if the version that was
    // kept is still live, it is archived in this draft's place first, so the
    // two never sit side by side sharing a keyword.
    const { data: self } = await supabase.from("content_drafts").select("metadata").eq("id", id).maybeSingle();
    const keeperId = readArchive(self?.metadata as Record<string, unknown> | null)?.duplicate_of ?? null;
    let swapped: string | null = null;
    if (keeperId) {
      const { data: keeper } = await supabase.from("content_drafts").select("id, status").eq("id", keeperId).maybeSingle();
      if (keeper && keeper.status !== "archived") {
        if (["approved", "published"].includes(keeper.status as string)) {
          return NextResponse.json(
            { error: "The version we kept is already approved or published. Send it back to draft before restoring this one." },
            { status: 409 },
          );
        }
        const a = await archiveDrafts({ supabase, ids: [keeperId], keeperId: id, reason: "Duplicate", archivedBy: user.email });
        if (a.archived.length === 0) return NextResponse.json({ error: a.errors.join("; ") || "Could not archive the kept version." }, { status: 409 });
        swapped = keeperId;
      }
    }
    const r = await restoreDraft({ supabase, id });
    if (!r.ok) {
      if (swapped) await restoreDraft({ supabase, id: swapped });
      return NextResponse.json({ error: r.error }, { status: r.error === "Not found" ? 404 : 409 });
    }
    await recordAuditEvent({ tenantId, draftId: id, event: "draft_restored", actorUserId: user.id, actorEmail: user.email, detail: { status: r.status, archived_in_place: swapped } });
    return NextResponse.json({ id, status: r.status, archivedInPlace: swapped });
  }

  if (input.action === "archive") {
    const reason = input.reason === "Off practice" ? "Off practice" : "Duplicate";
    const duplicateOf = reason === "Duplicate" && typeof input.duplicateOf === "string" ? input.duplicateOf.trim() : null;
    if (reason === "Duplicate" && !duplicateOf) {
      return NextResponse.json({ error: "Say which draft this duplicates." }, { status: 400 });
    }
    if (duplicateOf === id) return NextResponse.json({ error: "A draft cannot duplicate itself." }, { status: 400 });
    if (duplicateOf) {
      const { data: keeper } = await supabase.from("content_drafts").select("id").eq("id", duplicateOf).maybeSingle();
      if (!keeper) return NextResponse.json({ error: "The draft to keep was not found." }, { status: 404 });
    }
    const r = await archiveDrafts({ supabase, ids: [id], keeperId: duplicateOf, reason, archivedBy: user.email });
    if (r.archived.length === 0) return NextResponse.json({ error: r.errors.join("; ") || "Not found" }, { status: 404 });
    await recordAuditEvent({ tenantId, draftId: id, event: "draft_archived", actorUserId: user.id, actorEmail: user.email, detail: { reason, duplicate_of: duplicateOf } });
    return NextResponse.json({ id, status: "archived" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
