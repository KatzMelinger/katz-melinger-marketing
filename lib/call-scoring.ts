/**
 * Store a call's score and record who handled it.
 *
 * Shared by the nightly batch (lib/call-score-batch.ts) and the per-call
 * "Rescore" buttons so both write identical rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { scoreCall, type CallMetadataForScoring, type ScoreResult } from "@/lib/sales-coach";
import type { RubricType } from "@/lib/sales-coach-rubric";
import { attributeCall, type AttributionResult, type SalesStaff } from "@/lib/sales-staff";

/** Columns scoring needs from `calls`. */
export const CALL_SCORING_COLUMNS =
  "id, tenant_id, customer_name, customer_phone_number, duration, start_time, direction, source_name, transcription, staff_source";

type CallRow = Record<string, unknown>;

export type ScoreAndSaveOutcome =
  | { ok: true; result: ScoreResult; saved: Record<string, unknown> | null; attribution: AttributionResult }
  | { ok: false; error: string; result?: ScoreResult };

function s(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function callMetadata(call: CallRow): CallMetadataForScoring {
  return {
    callId: call.id as string,
    customerName: s(call.customer_name),
    duration: typeof call.duration === "number" ? call.duration : null,
    startTime: s(call.start_time),
    direction: s(call.direction),
    source: s(call.source_name),
  };
}

/** Insert the score row, then attribute the call to a staff member. */
export async function saveScore(params: {
  supabase: SupabaseClient;
  tenantId: string;
  call: CallRow;
  result: ScoreResult;
  staff: SalesStaff[];
}): Promise<ScoreAndSaveOutcome> {
  const { supabase, tenantId, call, result: r, staff } = params;
  const { data: saved, error } = await supabase
    .from("call_scores")
    .insert({
      call_id: call.id,
      tenant_id: tenantId,
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
      agent_name_detected: r.team_member_name,
      model_id: r.model_id,
      prompt_version: r.prompt_version,
    })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message, result: r };

  const attribution = await attributeCall({
    supabase,
    tenantId,
    callId: call.id as string,
    detectedName: r.team_member_name,
    customerPhone: s(call.customer_phone_number),
    currentSource: s(call.staff_source),
    staff,
  });

  return { ok: true, result: r, saved: (saved as Record<string, unknown>) ?? null, attribution };
}

/** Score one call immediately (full price) and save it. */
export async function scoreAndSave(params: {
  supabase: SupabaseClient;
  tenantId: string;
  call: CallRow;
  staff: SalesStaff[];
  rubricType?: RubricType;
}): Promise<ScoreAndSaveOutcome> {
  const { supabase, tenantId, call, staff, rubricType } = params;
  const transcript = s(call.transcription) ?? "";
  if (!transcript.trim()) return { ok: false, error: "no transcript" };

  const out = await scoreCall({ transcript, rubricType, callMetadata: callMetadata(call), supabase, tenantId });
  if (!out.ok) return { ok: false, error: out.error };
  return saveScore({ supabase, tenantId, call, result: out.result, staff });
}
