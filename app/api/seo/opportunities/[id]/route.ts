/**
 * PATCH /api/seo/opportunities/[id]
 *
 * Status writeback for a single opportunity — this is what gives the Radar
 * memory. Dismiss a junk keyword (status "dismissed") or move it through the
 * lifecycle. Dismissed/handled rows drop out of the default Radar list and stay
 * out across re-syncs (the sync job preserves locked statuses).
 *
 * Body: { status, decisionNotes?, briefId?, draftId? }
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_STATUSES = new Set([
  "new",
  "brief",
  "in_production",
  "published",
  "dismissed",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.status === "string") {
      if (!VALID_STATUSES.has(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      update.status = body.status;
    }
    if (typeof body.decisionNotes === "string") update.decision_notes = body.decisionNotes;
    if (typeof body.briefId === "string") update.brief_id = body.briefId;
    if (typeof body.draftId === "string") update.draft_id = body.draftId;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("seo_opportunities")
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ opportunity: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 },
    );
  }
}
