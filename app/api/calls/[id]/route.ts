/**
 * GET   /api/calls/[id] — single call with most recent score (if any), plus the
 *                         staff roster for the "Handled by" picker.
 * PATCH /api/calls/[id] — set who handled the call by hand.
 *                         Body: { staff_id: string | null }. A manual choice is
 *                         never overwritten by automatic attribution.
 */
import { NextResponse } from "next/server";

import { loadSalesStaff } from "@/lib/sales-staff";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const tid = await resolveTenantId();

  const [callQ, scoreQ, staff] = await Promise.all([
    supabase.from("calls").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle(),
    supabase
      .from("call_scores")
      .select("*")
      .eq("tenant_id", tid)
      .eq("call_id", id)
      .order("scored_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadSalesStaff(supabase, tid),
  ]);

  if (callQ.error) return NextResponse.json({ error: callQ.error.message }, { status: 500 });
  if (!callQ.data) return NextResponse.json({ error: "call not found" }, { status: 404 });

  return NextResponse.json({
    call: callQ.data,
    score: scoreQ.data ?? null,
    staff: staff.map((s) => ({ id: s.id, full_name: s.full_name })),
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  const { id } = await ctx.params;
  const tid = await resolveTenantId();
  const body = (await req.json().catch(() => ({}))) as { staff_id?: unknown };
  const staffId = typeof body.staff_id === "string" && body.staff_id ? body.staff_id : null;

  if (staffId) {
    const staff = await loadSalesStaff(supabase, tid);
    if (!staff.some((s) => s.id === staffId)) {
      return NextResponse.json({ error: "unknown staff member" }, { status: 400 });
    }
  }

  // Clearing the choice hands the call back to automatic attribution.
  const { error } = await supabase
    .from("calls")
    .update({ staff_id: staffId, staff_source: staffId ? "manual" : null })
    .eq("tenant_id", tid)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
