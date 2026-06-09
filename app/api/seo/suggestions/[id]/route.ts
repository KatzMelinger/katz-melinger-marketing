/**
 * /api/seo/suggestions/[id]
 *   GET    — fetch one suggestion (used by /seo/generator?suggestion=...)
 *   PATCH  — change status (approve / reject / hold) or edit fields
 *   DELETE — remove
 *
 * Status transitions are intentionally not enforced server-side beyond the
 * enum check — the UI is the source of workflow truth. Logging:
 * decided_at + decided_by + decision_notes get stamped on any status
 * change away from "pending".
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(["pending", "approved", "rejected", "held"]);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("brief_suggestions")
    .select("*")
    .eq("tenant_id", await resolveTenantId())
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof o.status === "string") {
    if (!VALID_STATUSES.has(o.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = o.status;
    if (o.status !== "pending") {
      patch.decided_at = new Date().toISOString();
    }
  }
  if (typeof o.decisionNotes === "string") patch.decision_notes = o.decisionNotes;
  if (typeof o.decidedBy === "string") patch.decided_by = o.decidedBy;
  if (typeof o.approvedDraftId === "string" && UUID_RE.test(o.approvedDraftId)) {
    patch.approved_draft_id = o.approvedDraftId;
  }
  // Allow editing the brief in-place (e.g. user revises before approving)
  if (o.suggestedBrief && typeof o.suggestedBrief === "object") {
    patch.suggested_brief = o.suggestedBrief;
  }
  if (typeof o.priority === "string") patch.priority = o.priority;
  if (typeof o.recommendedAction === "string") patch.recommended_action = o.recommendedAction;

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("brief_suggestions")
    .update(patch)
    .eq("tenant_id", await resolveTenantId())
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("brief_suggestions")
    .delete()
    .eq("tenant_id", await resolveTenantId())
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
