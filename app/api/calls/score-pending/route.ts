/**
 * POST /api/calls/score-pending — auto-score every answered call >= 60s that
 * has a transcript but no current score row. Designed to be hit by a cron.
 *
 * Body (optional): { limit: number, min_duration_seconds: number, since: ISO }
 *
 * Skips voicemails (the "answered=true && voicemail=true" combo) since those
 * aren't conversations.
 */
import { NextResponse } from "next/server";

import { scoreCall } from "@/lib/sales-coach";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;

export async function POST(req: Request) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  let body: Json = {};
  try {
    body = (await req.json().catch(() => ({}))) as Json;
  } catch {
    /* ignore */
  }
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(50, Math.floor(body.limit))) : 25;
  const minDuration =
    typeof body.min_duration_seconds === "number"
      ? Math.max(0, Math.floor(body.min_duration_seconds))
      : 60;
  const since = typeof body.since === "string" ? body.since : null;

  // Find candidates: answered, not VM, duration >= min, has transcript, no score yet.
  let q = supabase
    .from("calls")
    .select("id, customer_name, agent_email, duration, start_time, direction, source_name, transcription")
    .eq("answered", true)
    .eq("voicemail", false)
    .gte("duration", minDuration)
    .not("transcription", "is", null)
    .order("start_time", { ascending: false })
    .limit(500); // overshoot then filter
  if (since) q = q.gte("start_time", since);
  const { data: candidates, error } = await q;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (candidates ?? []).map((c) => (c as Json).id as string);
  let alreadyScored = new Set<string>();
  if (ids.length) {
    const { data: scored } = await supabase
      .from("call_scores")
      .select("call_id")
      .in("call_id", ids);
    alreadyScored = new Set((scored ?? []).map((r) => (r as Json).call_id as string));
  }

  const toScore = (candidates ?? []).filter((c) => !alreadyScored.has((c as Json).id as string)).slice(0, limit);

  const results: { id: string; ok: boolean; overall_score?: number; error?: string }[] = [];
  for (const row of toScore) {
    const c = row as Json;
    const id = c.id as string;
    const transcript = typeof c.transcription === "string" ? c.transcription : "";
    if (!transcript.trim()) {
      results.push({ id, ok: false, error: "no transcript" });
      continue;
    }
    const out = await scoreCall({
      transcript,
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
    if (!out.ok) {
      results.push({ id, ok: false, error: out.error });
      continue;
    }
    const r = out.result;
    const { error: insErr } = await supabase.from("call_scores").insert({
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
    });
    if (insErr) {
      results.push({ id, ok: false, error: insErr.message });
    } else {
      results.push({ id, ok: true, overall_score: r.overall_score });
    }
  }

  return NextResponse.json({
    candidates: candidates?.length ?? 0,
    skipped_already_scored: ids.length - toScore.length,
    scored: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
