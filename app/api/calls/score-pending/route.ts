/**
 * Auto-score every answered call >= 60s that has a transcript but no current
 * score row. Skips voicemails (the "answered=true && voicemail=true" combo)
 * since those aren't conversations.
 *
 * POST /api/calls/score-pending — UI trigger ("Score pending" button).
 *   Body (optional): { limit: number, min_duration_seconds: number, since: ISO }
 *
 * GET /api/calls/score-pending — Vercel Cron trigger. Requires
 *   `Authorization: Bearer ${CRON_SECRET}`. Reads the same options from query
 *   params (?limit=&min_duration_seconds=&since=). Registered in vercel.json.
 */
import { NextRequest, NextResponse } from "next/server";

import { scoreCall } from "@/lib/sales-coach";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Json = Record<string, unknown>;

type ScorePendingOptions = {
  limit: number;
  minDuration: number;
  since: string | null;
};

/**
 * Vercel injects `Authorization: Bearer ${CRON_SECRET}` on scheduled
 * invocations when CRON_SECRET is set. Reject anything else so the cron URL
 * can't be abused to burn Anthropic credits.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

function clampLimit(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(1, Math.min(50, Math.floor(raw)))
    : 25;
}

function clampDuration(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(0, Math.floor(raw))
    : 60;
}

export async function POST(req: Request) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  let body: Json = {};
  try {
    body = (await req.json().catch(() => ({}))) as Json;
  } catch {
    /* ignore */
  }
  return runScorePending(supabase, {
    limit: clampLimit(body.limit),
    minDuration: clampDuration(body.min_duration_seconds),
    since: typeof body.since === "string" ? body.since : null,
  });
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Cron has no user session — use the admin client (service role).
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const limitParam = sp.get("limit");
  const minParam = sp.get("min_duration_seconds");
  return runScorePending(supabase, {
    limit: clampLimit(limitParam ? Number(limitParam) : undefined),
    minDuration: clampDuration(minParam ? Number(minParam) : undefined),
    since: sp.get("since"),
  });
}

async function runScorePending(supabase: SupabaseClient, opts: ScorePendingOptions) {
  const { limit, minDuration, since } = opts;

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
