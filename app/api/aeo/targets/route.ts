/**
 * GET  /api/aeo/targets   — list self + competitors
 * POST /api/aeo/targets   — add a competitor
 *   body: { name, domain, aliases? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("aeo_targets")
    .select("*")
    .order("type", { ascending: true })
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ targets: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const aliases = Array.isArray(body.aliases) ? body.aliases : [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("aeo_targets")
    .insert({
      name: body.name,
      type: body.type === "self" ? "self" : "competitor",
      domain: body.domain ?? null,
      aliases,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
