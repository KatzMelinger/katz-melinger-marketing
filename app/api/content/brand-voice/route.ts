import { NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const sb = getSupabaseServer();
  if (!sb) {
    return NextResponse.json({
      error: "Supabase is not configured",
      context: "",
    });
  }
  const { data, error } = await sb
    .from("brand_voice")
    .select("id, context, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({
      error: error.message,
      context: "",
    });
  }
  const row = data as { context?: string | null } | null;
  return NextResponse.json({
    context: typeof row?.context === "string" ? row.context : "",
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const context = typeof o.context === "string" ? o.context : "";

  const sb = getSupabaseServer();
  if (!sb) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { data: existing } = await sb
    .from("brand_voice")
    .select("id")
    .limit(1)
    .maybeSingle();

  const id = existing && typeof existing === "object" && "id" in existing
    ? String((existing as { id: string }).id)
    : null;

  if (id) {
    const { error } = await sb
      .from("brand_voice")
      .update({
        context,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await sb.from("brand_voice").insert({
      context,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
