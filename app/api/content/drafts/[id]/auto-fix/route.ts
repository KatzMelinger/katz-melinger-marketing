/**
 * POST /api/content/drafts/[id]/auto-fix
 *
 * "Fix known errors" (Diana's Sept 28 spec, section 9): rewrites what has one
 * known correct answer, logs every change in "Changes made", and leaves the
 * log unreviewed so Approve waits for a person. Never changes status.
 * A draft for the wrong audience is flagged "Full redraft needed" instead.
 */
import { NextRequest, NextResponse } from "next/server";

import { getTenantClient } from "@/lib/tenant-db";
import { getCurrentUser } from "@/lib/supabase-route";
import { fixDraft } from "@/lib/auto-fix-draft";
import { scheduleDraftAnalysis } from "@/lib/auto-analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const { supabase, tenantId } = await getTenantClient();

  // RLS-scoped read first: a draft from another tenant is simply not found.
  const { data: visible } = await supabase.from("content_drafts").select("id").eq("id", id).maybeSingle();
  if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const out = await fixDraft({ draftId: id, tenantId, actor: { id: user.id, email: user.email } });
    if (out.skipped) return NextResponse.json({ error: `Not rewritten: ${out.skipped}.` }, { status: 409 });
    if (out.changes > 0 && out.result) {
      scheduleDraftAnalysis({ draftId: id, body: out.result.body, title: out.result.title });
    }
    return NextResponse.json({
      id,
      changes: out.changes,
      attorneyReview: out.attorneyReview,
      fullRedraft: out.fullRedraft,
      body: out.result?.body,
      title: out.result?.title,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Rewrite failed" }, { status: 500 });
  }
}
