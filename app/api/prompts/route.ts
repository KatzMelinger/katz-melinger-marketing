/**
 * GET  /api/prompts         — list all prompts (newest first)
 *   query: ?projectId=… to filter
 * POST /api/prompts         — create a prompt
 *   body: { title, description?, system_prompt?, user_prompt, model?, max_tokens?, tags?, project_id? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { extractVariables } from "@/lib/prompt-runner";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("ai_prompts")
    .select("id, project_id, title, description, variables, model, max_tokens, tags, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prompts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = (body?.title as string | undefined)?.trim();
  const userPrompt = (body?.user_prompt as string | undefined)?.trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!userPrompt) return NextResponse.json({ error: "user_prompt required" }, { status: 400 });

  const variables = extractVariables(body?.system_prompt, userPrompt);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_prompts")
    .insert({
      project_id: body?.project_id ?? null,
      title,
      description: body?.description ?? null,
      variables,
      system_prompt: body?.system_prompt ?? null,
      user_prompt: userPrompt,
      model: body?.model ?? "claude-sonnet-4-5-20250929",
      max_tokens: Number(body?.max_tokens ?? 4096),
      tags: Array.isArray(body?.tags) ? body.tags : [],
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prompt: data });
}
