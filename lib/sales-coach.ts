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

const DEFAULT_MODEL = process.env.SALES_COACH_MODEL?.trim() || "claude-opus-5-5";

// Opus 5.5 always thinks; effort is the depth control (its default is medium).
const EFFORT = (["low", "medium", "high", "max"] as const).find(
  (e) => e === process.env.SALES_COACH_EFFORT?.trim(),
) ?? "medium";

// v3: the model picks the rubric from all three (v2 always loaded the
// consultation rubric unless a caller forced one, so auto-scored intake calls
// were graded on sales dimensions), and reports the team member's name.
// Scores are stamped with model_id + prompt_version so v2 and v3 rows are
// never silently compared.
export const PROMPT_VERSION = 3;

const RUBRIC_TYPES: readonly RubricType[] = ["intake", "consultation", "callback"];

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
  /** First name the Katz Melinger team member used on the call, if any. */
  team_member_name: string | null;
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

function buildSystemBlocks(rubrics: RubricSet): Anthropic.MessageCreateParamsNonStreaming["system"] {
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
        "RUBRICS\n" +
        "First decide which kind of call this is, then score it against that rubric only:\n" +
        "- intake: a first conversation with a potential client to gather the facts of their " +
        "situation (incoming intake script 5.1.2-a, or an outgoing intake call per 5.1.2-b).\n" +
        "- consultation: a sales / case-evaluator call that presents the firm's fee, handles " +
        "objections and asks for the engagement (5.2.3-a).\n" +
        "- callback: a follow-up with someone already in the pipeline about a prior conversation, " +
        "an engagement letter, documents or next steps.\n" +
        "If the call metadata gives a forced_rubric_type, use that rubric regardless.\n\n" +
        "Score each dimension 0–max based on transcript evidence. " +
        "Provide one short evidence quote, what was missed (if anything), " +
        "and a one-sentence 'do better' suggestion grounded in the SOP.\n\n" +
        RUBRIC_TYPES.map(
          (t) => `=== ${t.toUpperCase()} RUBRIC (rubric_type "${t}") ===\n${rubricBlockText(rubrics[t])}`,
        ).join("\n\n"),
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
        '  "summary_manager": "<2–3 sentence feedback for the manager, ALWAYS IN ENGLISH, naming the 1 thing to coach>",\n' +
        '  "team_member_name": "<first name the Katz Melinger team member uses for themselves or is called by on this call>" | null\n' +
        "}\n\n" +
        "Rules:\n" +
        "- 'overall_score' must equal the rounded sum of all dimension scores normalized to 100.\n" +
        "- Do not state a numeric score in either summary; the app computes and displays the total.\n" +
        "- Score every dimension of the chosen rubric and no others: intake_* keys for 'intake', consult_* keys for 'consultation', callback_* keys for 'callback'.\n" +
        "- 'team_member_name' is the Katz Melinger side of the call, never the caller. Write it as said in the transcript (e.g. \"Alicia\", \"Andre\"); use null if they never give or hear their name.\n" +
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
  rubricType?: RubricType; // if omitted, the model picks intake / consultation / callback
  callMetadata: CallMetadataForScoring;
  supabase: SupabaseClient | null;
  tenantId?: string; // scope rubric overrides to this firm
};

export type ScoreCallOutcome =
  | { ok: true; result: ScoreResult }
  | { ok: false; error: string };

export type RubricSet = Record<RubricType, RubricDimension[]>;

/** All three rubrics, with this tenant's overrides applied. */
export async function loadRubricSet(supabase: SupabaseClient | null, tenantId?: string): Promise<RubricSet> {
  return Object.fromEntries(
    await Promise.all(RUBRIC_TYPES.map(async (t) => [t, await loadRubric(supabase, t, tenantId)] as const)),
  ) as RubricSet;
}

/**
 * The Messages API request for one call. All three rubrics go into the
 * (cached) system prompt and the model picks one, so the ~50 KB of SOPs +
 * rubrics is identical, and cached, across every call in a run. Used as-is
 * by the nightly batch and by scoreCall() for one-off rescoring.
 */
export function buildScoringParams(
  rubrics: RubricSet,
  meta: CallMetadataForScoring,
  transcript: string,
  forced?: RubricType,
): Anthropic.MessageCreateParamsNonStreaming {
  const userText = [
    "CALL METADATA",
    `call_id: ${meta.callId}`,
    `customer_name: ${meta.customerName ?? "Unknown"}`,
    `direction: ${meta.direction ?? "Unknown"}`,
    `duration_seconds: ${meta.duration ?? "Unknown"}`,
    `start_time: ${meta.startTime ?? "Unknown"}`,
    `source: ${meta.source ?? "Unknown"}`,
    `forced_rubric_type: ${forced ?? "none"}`,
    "",
    "TRANSCRIPT",
    transcript,
    "",
    "TASK: Produce the JSON object now. No markdown. No commentary outside the JSON.",
  ].join("\n");
  return {
    model: DEFAULT_MODEL,
    max_tokens: 16000,
    output_config: { effort: EFFORT },
    system: buildSystemBlocks(rubrics),
    messages: [{ role: "user", content: userText }],
  };
}

export type ScoringAttempt =
  | { ok: true; result: ScoreResult; complete: boolean }
  | { ok: false; error: string };

/**
 * Turn a scoring response into a ScoreResult. `complete` is false when the
 * model mixed rubrics or skipped dimensions of the one it chose.
 */
export function parseScoringMessage(
  message: Anthropic.Message,
  rubrics: RubricSet,
  callId: string,
  forced?: RubricType,
): ScoringAttempt {
  const u = message.usage;
  console.log(
    `[sales-coach] ${callId} in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} ` +
      `cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
  );
  if (message.stop_reason === "refusal") return { ok: false, error: "Model declined to score this call" };
  if (message.stop_reason === "max_tokens") return { ok: false, error: "Scoring output was cut off (max_tokens)" };
  const block = message.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;

  // Extract JSON (defensively — the model might wrap it in ```json fences)
  const jsonText = extractJson(block?.text ?? "");
  if (!jsonText) return { ok: false, error: "Model returned no JSON" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const o = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const reported = RUBRIC_TYPES.find((t) => t === o.rubric_type);
  const rubricType: RubricType = forced ?? reported ?? "intake";
  const rubric = rubrics[rubricType];
  const result = normalizeScore(parsed, rubricType, rubric, message.model || DEFAULT_MODEL);

  const expected = new Set(rubric.map((d) => d.dimensionKey));
  const got = new Set(result.dimensions.map((d) => d.dimension_key));
  const complete =
    result.overall_score === 0 || // empty / unintelligible call: nothing to score
    (got.size === expected.size && [...got].every((k) => expected.has(k)));
  return { ok: true, result, complete };
}

/** Score one call right now (the call page's Rescore buttons). */
export async function scoreCall(params: ScoreCallParams): Promise<ScoreCallOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
  const transcript = params.transcript?.trim() ?? "";
  if (!transcript) return { ok: false, error: "Transcript is empty" };

  const rubrics = await loadRubricSet(params.supabase, params.tenantId);
  const client = new Anthropic({ apiKey });

  async function attempt(forced?: RubricType): Promise<ScoringAttempt> {
    try {
      // fallbacks: "default" (server-side refusal fallback) isn't in this SDK
      // version's types yet, so it rides along on the body with its beta header.
      // The Batches API rejects it, so only this live path sends it.
      const body = {
        ...buildScoringParams(rubrics, params.callMetadata, transcript, forced),
        fallbacks: "default",
      } as Anthropic.MessageCreateParamsNonStreaming;
      const message = await client.messages.create(body, {
        headers: { "anthropic-beta": "server-side-fallback-2026-07-01" },
      });
      return parseScoringMessage(message, rubrics, params.callMetadata.callId, forced);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Anthropic call failed" };
    }
  }

  const first = await attempt(params.rubricType);
  if (!first.ok || first.complete) return first.ok ? { ok: true, result: first.result } : first;

  // The model mixed rubrics or skipped dimensions. Re-run once with the rubric
  // it chose enforced; if that is still incomplete, keep the better attempt.
  const retry = await attempt(first.result.rubric_type);
  if (retry.ok) return { ok: true, result: retry.result };
  return { ok: true, result: first.result };
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

function normalizeScore(
  parsed: unknown,
  rubricType: RubricType,
  rubric: RubricDimension[],
  modelId: string,
): ScoreResult {
  const o = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const language = (["en", "es", "mixed", "unknown"].includes(str(o.language))
    ? str(o.language)
    : "unknown") as ScoreResult["language"];
  const case_quality_estimate = (["High", "Medium", "Low", "N/A"].includes(str(o.case_quality_estimate))
    ? str(o.case_quality_estimate)
    : "N/A") as ScoreResult["case_quality_estimate"];
  // Keep only dimensions that belong to the chosen rubric, so a stray key
  // from another rubric can't distort the total with a guessed max.
  const dimensions = arr(o.dimensions).flatMap((d) => {
    const dd = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
    const key = str(dd.dimension_key);
    const def = rubric.find((r) => r.dimensionKey === key);
    if (!def) return [];
    return [
      {
        dimension_key: key,
        dimension_name: def.dimensionName,
        score: clampInt(dd.score, 0, def.maxScore),
        max: def.maxScore,
        evidence: str(dd.evidence),
        missed: str(dd.missed),
        do_better: str(dd.do_better),
      } as DimensionScore,
    ];
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
    team_member_name: str(o.team_member_name).trim() || null,
    model_id: modelId,
    prompt_version: PROMPT_VERSION,
  };
}
