/**
 * Shared logic for the keyword research async job pattern.
 *
 * Each route (discover, expand, competitor-gaps) has two endpoints:
 *
 *   POST /api/keyword-research/<type>/start  — creates a job, kicks off the
 *     Anthropic call in the background via waitUntil(), returns { jobId }.
 *
 *   GET /api/keyword-research/<type>/status?id=<jobId> — returns the current
 *     state of the job. When status is "done", includes the result.
 *
 * The actual Anthropic call runs in the background via Vercel's waitUntil(),
 * which lets a function continue executing AFTER the HTTP response is sent.
 * This sidesteps Vercel's function timeout for the request/response cycle —
 * the background work has its own time budget (up to 5 minutes on Pro).
 */

import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import {
  getAnthropic,
  KEYWORD_RESEARCH_MODEL,
  extractJSON,
} from "@/lib/anthropic";

export type JobType = "discover" | "expand" | "competitor-gaps";

export type JobStatus = "pending" | "running" | "done" | "failed";

export type JobRow = {
  id: string;
  job_type: JobType;
  status: JobStatus;
  request_params: any;
  result: any | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

/**
 * Insert a new job row in pending state and return its id.
 * The caller should kick off the actual work via waitUntil() right after.
 */
export async function createJob(
  jobType: JobType,
  requestParams: any,
): Promise<string> {
  const supabase = getSupabaseServer();
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("keyword_research_jobs")
    .insert({
      job_type: jobType,
      status: "pending",
      request_params: requestParams,
      tenant_id: await resolveTenantId(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create job: ${error.message}`);
  return data.id;
}

/**
 * Fetch a single job by id. Returns null if not found.
 */
export async function getJob(jobId: string): Promise<JobRow | null> {
  const supabase = getSupabaseServer();
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("keyword_research_jobs")
    .select("*")
    .eq("tenant_id", await resolveTenantId())
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch job: ${error.message}`);
  return (data as JobRow | null) ?? null;
}

/**
 * Mark a job as running. Called at the start of the background work.
 */
async function markRunning(jobId: string): Promise<void> {
  const supabase = getSupabaseServer();
  if (!supabase) return;
  await supabase
    .from("keyword_research_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId);
}

/**
 * Mark a job as done with the parsed result.
 */
async function markDone(jobId: string, result: any): Promise<void> {
  const supabase = getSupabaseServer();
  if (!supabase) return;
  await supabase
    .from("keyword_research_jobs")
    .update({
      status: "done",
      result,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

/**
 * Mark a job as failed with an error message.
 */
async function markFailed(jobId: string, errMsg: string): Promise<void> {
  const supabase = getSupabaseServer();
  if (!supabase) return;
  await supabase
    .from("keyword_research_jobs")
    .update({
      status: "failed",
      error: errMsg,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

/**
 * Run an Anthropic call in the background and write the result back to the
 * job row. Designed to be called via Vercel's waitUntil().
 *
 * Catches all errors and writes them to the row so the frontend can poll and
 * see "failed" instead of timing out.
 */
export async function runAnthropicJob(args: {
  jobId: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}): Promise<void> {
  const { jobId, systemPrompt, userPrompt, maxTokens = 6000 } = args;

  try {
    await markRunning(jobId);

    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    let parsed: any;
    try {
      parsed = extractJSON(text);
    } catch (parseErr: any) {
      throw new Error(`Failed to parse AI response: ${parseErr.message}`);
    }

    await markDone(jobId, parsed);
  } catch (err: any) {
    console.error(`[keyword-research-jobs] Job ${jobId} failed:`, err?.message);
    await markFailed(jobId, err?.message || "Unknown error");
  }
}