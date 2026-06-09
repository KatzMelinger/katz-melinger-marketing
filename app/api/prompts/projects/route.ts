/**
 * GET  /api/prompts/projects   — list projects
 * POST /api/prompts/projects   — create
 *   body: { name, description?, tags? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_projects")
    .select("*")
    .eq("tenant_id", await resolveTenantId())
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = (body?.name as string | undefined)?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ai_projects")
    .insert({
      name,
      description: body?.description ?? null,
      tags: Array.isArray(body?.tags) ? body.tags : [],
      tenant_id: await resolveTenantId(),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: data });
}
