/**
 * POST /api/prompts/[id]/run
 *   body: { variables?: Record<string, string>, max_tokens?: number }
 *
 * Renders the prompt with the supplied variables, runs it against Claude,
 * persists the result in ai_prompt_runs, returns the output + usage.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { runPrompt } from "@/lib/prompt-runner";
import { getCurrentUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tid = await resolveTenantId();
  const body = await req.json().catch(() => ({}));
  const variables = (body?.variables ?? {}) as Record<string, string>;
  const maxTokensOverride = Number(body?.max_tokens ?? NaN);

  const supabase = getSupabaseAdmin();
  const { data: prompt, error } = await supabase
    .from("ai_prompts")
    .select("*")
    .eq("tenant_id", tid)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!prompt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const me = await getCurrentUser();

  try {
    const result = await runPrompt({
      systemPrompt: prompt.system_prompt as string | null,
      userPrompt: prompt.user_prompt as string,
      variables,
      model: prompt.model as string,
      maxTokens: Number.isFinite(maxTokensOverride) ? maxTokensOverride : (prompt.max_tokens as number),
    });

    await supabase.from("ai_prompt_runs").insert({
      prompt_id: id,
      variables,
      rendered_user: result.rendered.user,
      rendered_system: result.rendered.system,
      model: prompt.model,
      output: result.output,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_estimate: result.costEstimate,
      latency_ms: result.latencyMs,
      status: "success",
      ran_by: me?.id ?? null,
      tenant_id: tid,
    });

    return NextResponse.json({
      output: result.output,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_estimate: result.costEstimate,
      latency_ms: result.latencyMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Run failed";
    await supabase.from("ai_prompt_runs").insert({
      prompt_id: id,
      variables,
      rendered_user: prompt.user_prompt as string,
      rendered_system: prompt.system_prompt as string | null,
      model: prompt.model,
      status: "failed",
      error: msg,
      ran_by: me?.id ?? null,
      tenant_id: tid,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
