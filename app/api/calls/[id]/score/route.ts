/**
 * POST /api/calls/[id]/score — score (or rescore) a single call against the
 * SOP rubric. Body (optional): { rubric_type: "intake" | "consultation" | "callback" }.
 * If omitted, the model picks the rubric.
 */
import { NextResponse } from "next/server";

import { CALL_SCORING_COLUMNS, scoreAndSave } from "@/lib/call-scoring";
import { loadSalesStaff } from "@/lib/sales-staff";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Json = Record<string, unknown>;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: Json = {};
  try {
    body = (await req.json().catch(() => ({}))) as Json;
  } catch {
    /* ignore */
  }
  const rubricTypeRaw = typeof body.rubric_type === "string" ? body.rubric_type : "";
  const rubric_type =
    rubricTypeRaw === "intake" || rubricTypeRaw === "consultation" || rubricTypeRaw === "callback"
      ? rubricTypeRaw
      : undefined;

  const tid = await resolveTenantId();
  const { data: call, error: cErr } = await supabase
    .from("calls")
    .select(CALL_SCORING_COLUMNS)
    .eq("tenant_id", tid)
    .eq("id", id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });

  const c = call as Json;
  if (typeof c.transcription !== "string" || !c.transcription.trim()) {
    return NextResponse.json({ error: "no transcript on this call yet" }, { status: 422 });
  }

  const out = await scoreAndSave({
    supabase,
    tenantId: tid,
    call: c,
    staff: await loadSalesStaff(supabase, tid),
    rubricType: rubric_type,
  });
  if (!out.ok) {
    return NextResponse.json({ error: out.error, result: out.result }, { status: out.result ? 500 : 502 });
  }
  return NextResponse.json({ score: out.saved, result: out.result, staff: out.attribution.staff?.full_name ?? null });
}
