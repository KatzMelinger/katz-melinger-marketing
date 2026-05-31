/**
 * Sales Coach scoring engine.
 *
 * Takes a CallRail transcript + rubric + SOPs and returns a structured
 * evaluation: per-dimension scores, objection log, compliance flags,
 * bilingual summaries, and concrete script recommendations.
 *
 * Architecture notes:
 *   - Uses Anthropic prompt caching via `cache_control: { type: "ephemeral" }`.
 *     The SOPs + rubric (~50 KB) are placed in a single cached system block,
 *     so each subsequent call within ~5 min reads from cache at ~10% cost.
 *   - Model is configurable via SALES_COACH_MODEL (defaults to the same
 *     model the rest of the app already uses).
 *   - Output is JSON parsed + validated against a known shape; partial
 *     failures fall back to safe defaults rather than throwing.
 */

import Anthropic from "@anthropic-ai/sdk";

import { ALL_SOPS } from "@/lib/sales-coach-sops";
import {
  loadRubric,
  type RubricDimension,
  type RubricType,
} from "@/lib/sales-coach-rubric";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_MODEL =
  process.env.SALES_COACH_MODEL?.trim() || "claude-sonnet-4-20250514";

export const PROMPT_VERSION = 1;

export type CallMetadataForScoring = {
  callId: string;
  customerName?: string | null;
  agentEmail?: string | null;
  duration?: number | null;
  startTime?: string | null;
  direction?: string | null;
  source?: string | null;
};

export type DimensionScore = {
  dimension_key: string;
  dimension_name: string;
  score: number;
  max: number;
  evidence: string;
  missed: string;
  do_better: string;
};

export type ObjectionLogEntry = {
  objection: string;
  response_used: string;
  alignment: "matches_1st_attempt" | "matches_2nd_attempt" | "matches_last_resort" | "deviated" | "missed";
  notes: string;
};

export type ComplianceFlag = {
  phrase: string;
  severity: "low" | "medium" | "high";
  excerpt: string;
};

export type ScoreResult = {
  rubric_type: RubricType;
  language: "en" | "es" | "mixed" | "unknown";
  case_type_detected: string | null;
  case_quality_estimate: "High" | "Medium" | "Low" | "N/A";
  overall_score: number;
  dimensions: DimensionScore[];
  objections_log: ObjectionLogEntry[];
  compliance_flags: ComplianceFlag[];
  script_recommendations: string[];
  summary_screener: string;
  summary_manager: string;
  model_id: string;
  prompt_version: number;
};

/* -------------------------------------------------------------------------- */
/* Prompt construction                                                        */
/* -------------------------------------------------------------------------- */

function rubricBlockText(dims: RubricDimension[]): string {
  return dims
    .map((d, i) => {
      return [
        `${i + 1}. ${d.dimensionName}  [key: ${d.dimensionKey}, max: ${d.maxScore}]`,
        `   SOP ref: ${d.sopReference}`,
        `   Criteria: ${d.criteriaText}`,
      ].join("\n");
    })
    .join("\n\n");
}

function sopsBlockText(): string {
  return ALL_SOPS.map((s) => {
    return [
      "===========================================================================",
      `${s.fileName} (${s.sectionCode}, ${s.docType})`,
      "===========================================================================",
      s.text,
    ].join("\n");
  }).join("\n\n");
}

function buildSystemBlocks(rubric: RubricDimension[]): Anthropic.MessageCreateParamsNonStreaming["system"] {
  // The order matters for caching: put the largest, most stable content first
  // and mark it cacheable. Per-call inputs (transcript + rubric metadata) go
  // in the user message.
  return [
    {
      type: "text",
      text:
        "You are the Katz Melinger PLLC Sales Coach. " +
        "Your job is to listen to a call between a Katz Melinger team member " +
        "(intake specialist or sales/case evaluator) and a potential client (PC), " +
        "then grade it against the firm's own SOPs. You are bilingual in English " +
        "and South / Central American Spanish. " +
        "The PC may be calling from anywhere in the US; the firm practices in NY and NJ. " +
        "Be specific, be fair, and ground every score in transcript evidence.",
    },
    {
      type: "text",
      text:
        "FIRM SOURCE OF TRUTH — KATZ MELINGER SOPs AND SCRIPTS\n" +
        "These are the standards you score against. Treat any deviation as a coachable moment, " +
        "but only count clear deviations from the spirit of the SOP — minor paraphrasing is fine.\n\n" +
        sopsBlockText(),
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text:
        "RUBRIC FOR THIS CALL TYPE\n" +
        "Score each dimension 0–max based on transcript evidence. " +
        "Provide one short evidence quote, what was missed (if anything), " +
        "and a one-sentence 'do better' suggestion grounded in the SOP.\n\n" +
        rubricBlockText(rubric),
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text:
        "OUTPUT FORMAT (STRICT JSON — no markdown, no commentary outside the JSON):\n" +
        "{\n" +
        '  "rubric_type": "intake" | "consultation" | "callback",\n' +
        '  "language": "en" | "es" | "mixed" | "unknown",\n' +
        '  "case_type_detected": "wage_and_hour" | "severance" | "discrimination" | "collections_pre_lit" | "judgment_enforcement" | "collections_litigation" | "domestication" | "hourly_advisory" | "unclear" | null,\n' +
        '  "case_quality_estimate": "High" | "Medium" | "Low" | "N/A",\n' +
        '  "overall_score": <int 0..100>,\n' +
        '  "dimensions": [ { "dimension_key": "...", "score": <int>, "evidence": "<short quote>", "missed": "<what was missed>", "do_better": "<one sentence>" } ],\n' +
        '  "objections_log": [ { "objection": "...", "response_used": "...", "alignment": "matches_1st_attempt"|"matches_2nd_attempt"|"matches_last_resort"|"deviated"|"missed", "notes": "..." } ],\n' +
        '  "compliance_flags": [ { "phrase": "<exact forbidden phrase>", "severity": "low"|"medium"|"high", "excerpt": "<sentence containing it>" } ],\n' +
        '  "script_recommendations": [ "<one concrete recommendation, in the call language, citing SOP section>" ],\n' +
        '  "summary_screener": "<2–3 sentence feedback for the screener, IN THE CALL LANGUAGE (Spanish if call was in Spanish)>",\n' +
        '  "summary_manager": "<2–3 sentence feedback for the manager, ALWAYS IN ENGLISH, including overall score and 1 thing to coach>"\n' +
        "}\n\n" +
        "Rules:\n" +
        "- 'overall_score' must equal the rounded sum of all dimension scores normalized to 100.\n" +
        "- If the rubric is 'intake', use only intake_* dimension keys; if 'consultation', use only consult_* keys; if 'callback', use only callback_* keys.\n" +
        "- 'compliance_flags' lists every distinct occurrence of any of the 11 forbidden phrases from 5.2.3-a.\n" +
        "- Spanish summaries should use neutral South/Central American Spanish, default to 'usted'.\n" +
        "- If the transcript is missing or the call is < 60 seconds and unintelligible, return overall_score=0 and explain in summary_manager.\n" +
        "- NEVER fabricate evidence. If you can't find a quote, say so in 'evidence'.",
      cache_control: { type: "ephemeral" },
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export type ScoreCallParams = {
  transcript: string;
  rubricType?: RubricType; // if omitted, the model decides between intake/consultation
  callMetadata: CallMetadataForScoring;
  supabase: SupabaseClient | null;
};

export type ScoreCallOutcome =
  | { ok: true; result: ScoreResult }
  | { ok: false; error: string };

export async function scoreCall(params: ScoreCallParams): Promise<ScoreCallOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
  const transcript = params.transcript?.trim() ?? "";
  if (!transcript) return { ok: false, error: "Transcript is empty" };

  // Decide rubric: if caller didn't tell us, default to consultation since
  // it's the more demanding rubric; the model will still report rubric_type
  // and we re-run with the right rubric if it disagrees.
  const rubricType: RubricType = params.rubricType ?? "consultation";
  const rubric = await loadRubric(params.supabase, rubricType);

  const client = new Anthropic({ apiKey });
  const system = buildSystemBlocks(rubric);

  const userText = [
    "CALL METADATA",
    `call_id: ${params.callMetadata.callId}`,
    `customer_name: ${params.callMetadata.customerName ?? "Unknown"}`,
    `agent_email: ${params.callMetadata.agentEmail ?? "Unknown"}`,
    `direction: ${params.callMetadata.direction ?? "Unknown"}`,
    `duration_seconds: ${params.callMetadata.duration ?? "Unknown"}`,
    `start_time: ${params.callMetadata.startTime ?? "Unknown"}`,
    `source: ${params.callMetadata.source ?? "Unknown"}`,
    `default_rubric_type: ${rubricType}`,
    "",
    "TRANSCRIPT",
    transcript,
    "",
    "TASK: Produce the JSON object now. No markdown. No commentary outside the JSON.",
  ].join("\n");

  let raw: string;
  try {
    const message = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: userText }],
    });
    const block = message.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
    raw = block?.text ?? "";
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Anthropic call failed" };
  }

  // Extract JSON (defensively — the model might wrap it in ```json fences)
  const jsonText = extractJson(raw);
  if (!jsonText) return { ok: false, error: "Model returned no JSON" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const result = normalizeScore(parsed, rubric, DEFAULT_MODEL);
  return { ok: true, result };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return trimmed;
  // Try fenced code block
  const m = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  // Otherwise look for the first { … last }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return null;
}

function clampInt(v: unknown, lo: number, hi: number, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeScore(parsed: unknown, rubric: RubricDimension[], modelId: string): ScoreResult {
  const o = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const rubricType = (str(o.rubric_type) || "consultation") as RubricType;
  const language = (["en", "es", "mixed", "unknown"].includes(str(o.language))
    ? str(o.language)
    : "unknown") as ScoreResult["language"];
  const case_quality_estimate = (["High", "Medium", "Low", "N/A"].includes(str(o.case_quality_estimate))
    ? str(o.case_quality_estimate)
    : "N/A") as ScoreResult["case_quality_estimate"];
  const dimensions = arr(o.dimensions).map((d) => {
    const dd = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
    const key = str(dd.dimension_key);
    const def = rubric.find((r) => r.dimensionKey === key);
    const max = def?.maxScore ?? clampInt(dd.max, 0, 100, 10);
    return {
      dimension_key: key,
      dimension_name: def?.dimensionName ?? str(dd.dimension_name),
      score: clampInt(dd.score, 0, max),
      max,
      evidence: str(dd.evidence),
      missed: str(dd.missed),
      do_better: str(dd.do_better),
    } as DimensionScore;
  });

  const objections_log = arr(o.objections_log).map((it) => {
    const ii = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
    const align = str(ii.alignment) as ObjectionLogEntry["alignment"];
    return {
      objection: str(ii.objection),
      response_used: str(ii.response_used),
      alignment: ["matches_1st_attempt", "matches_2nd_attempt", "matches_last_resort", "deviated", "missed"].includes(align)
        ? align
        : ("missed" as ObjectionLogEntry["alignment"]),
      notes: str(ii.notes),
    } as ObjectionLogEntry;
  });

  const compliance_flags = arr(o.compliance_flags).map((it) => {
    const ii = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
    const sev = str(ii.severity) as ComplianceFlag["severity"];
    return {
      phrase: str(ii.phrase),
      severity: ["low", "medium", "high"].includes(sev) ? sev : ("medium" as ComplianceFlag["severity"]),
      excerpt: str(ii.excerpt),
    } as ComplianceFlag;
  });

  const script_recommendations = arr(o.script_recommendations).map((s) => str(s)).filter((s) => s.length > 0);

  // Recompute overall_score from dimensions for consistency, but trust the model if dimensions empty
  let overall = clampInt(o.overall_score, 0, 100, 0);
  if (dimensions.length > 0) {
    const earned = dimensions.reduce((sum, d) => sum + d.score, 0);
    const possible = dimensions.reduce((sum, d) => sum + d.max, 0);
    overall = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  }

  return {
    rubric_type: rubricType,
    language,
    case_type_detected: o.case_type_detected == null ? null : str(o.case_type_detected) || null,
    case_quality_estimate,
    overall_score: overall,
    dimensions,
    objections_log,
    compliance_flags,
    script_recommendations,
    summary_screener: str(o.summary_screener),
    summary_manager: str(o.summary_manager),
    model_id: modelId,
    prompt_version: PROMPT_VERSION,
  };
}
