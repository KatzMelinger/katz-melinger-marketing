/**
 * POST /api/calls/[id]/score — score (or rescore) a single call against the
 * SOP rubric. Body (optional): { rubric_type: "intake" | "consultation" }.
 * If omitted, the model decides.
 */
import { NextResponse } from "next/server";

import { scoreCall } from "@/lib/sales-coach";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

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
  const { data: call, error: cErr } = await supabase.from("calls").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });

  const c = call as Json;
  const transcript = typeof c.transcription === "string" ? c.transcription : "";
  if (!transcript.trim()) {
    return NextResponse.json({ error: "no transcript on this call yet" }, { status: 422 });
  }

  const result = await scoreCall({
    transcript,
    rubricType: rubric_type,
    callMetadata: {
      callId: id,
      customerName: typeof c.customer_name === "string" ? c.customer_name : null,
      agentEmail: typeof c.agent_email === "string" ? c.agent_email : null,
      duration: typeof c.duration === "number" ? c.duration : null,
      startTime: typeof c.start_time === "string" ? c.start_time : null,
      direction: typeof c.direction === "string" ? c.direction : null,
      source: typeof c.source_name === "string" ? c.source_name : null,
    },
    supabase,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const r = result.result;
  const insertRow = {
    call_id: id,
    rubric_type: r.rubric_type,
    language: r.language,
    overall_score: r.overall_score,
    case_quality_estimate: r.case_quality_estimate,
    case_type_detected: r.case_type_detected,
    dimension_scores: r.dimensions,
    objections_log: r.objections_log,
    compliance_flags: r.compliance_flags,
    script_recommendations: r.script_recommendations,
    summary_screener: r.summary_screener,
    summary_manager: r.summary_manager,
    model_id: r.model_id,
    prompt_version: r.prompt_version,
    tenant_id: tid,
  };

  const { data: saved, error: sErr } = await supabase
    .from("call_scores")
    .insert(insertRow)
    .select("*")
    .maybeSingle();

  if (sErr) {
    return NextResponse.json({ error: sErr.message, result: r }, { status: 500 });
  }

  return NextResponse.json({ score: saved, result: r });
}
