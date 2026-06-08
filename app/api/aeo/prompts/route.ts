/**
 * GET  /api/aeo/prompts          — list all prompts
 * POST /api/aeo/prompts          — create a prompt
 *   body: { prompt, category?, intent?, geography?, enabled? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

export async function GET() {
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("aeo_prompts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prompts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body?.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("aeo_prompts")
    .insert({
      prompt: body.prompt,
      category: body.category ?? null,
      intent: body.intent ?? null,
      geography: body.geography ?? null,
      enabled: body.enabled !== false,
      tenant_id: tenantId,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
