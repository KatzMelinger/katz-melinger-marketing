/**
 * GET    /api/prompts/[id]   — single prompt with full body
 * PATCH  /api/prompts/[id]   — update fields; auto re-extracts variables
 * DELETE /api/prompts/[id]   — remove (cascades to runs)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";
import { extractVariables } from "@/lib/prompt-runner";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_prompts")
    .select("*")
    .eq("tenant_id", await resolveTenantId())
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ prompt: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const key of [
    "project_id",
    "title",
    "description",
    "system_prompt",
    "user_prompt",
    "model",
    "max_tokens",
    "tags",
  ]) {
    if (key in (body ?? {})) patch[key] = body[key];
  }
  if ("system_prompt" in patch || "user_prompt" in patch) {
    // Refresh variables from whichever field is present (or both).
    const supabase = getSupabaseAdmin();
    const { data: existing } = await supabase
      .from("ai_prompts")
      .select("system_prompt, user_prompt")
      .eq("tenant_id", await resolveTenantId())
      .eq("id", id)
      .maybeSingle();
    const sys = "system_prompt" in patch ? (patch.system_prompt as string | null) : existing?.system_prompt;
    const user = "user_prompt" in patch ? (patch.user_prompt as string) : existing?.user_prompt ?? "";
    patch.variables = extractVariables(sys, user);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_prompts")
    .update(patch)
    .eq("tenant_id", await resolveTenantId())
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prompt: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("ai_prompts").delete().eq("tenant_id", await resolveTenantId()).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
