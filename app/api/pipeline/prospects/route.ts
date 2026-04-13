import { NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const sb = getSupabaseServer();
  if (!sb) {
    return NextResponse.json(
      { error: "Supabase is not configured", prospects: [] },
      { status: 503 },
    );
  }
  const { data, error } = await sb
    .from("prospects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message, prospects: [] }, { status: 500 });
  }
  return NextResponse.json({ prospects: data ?? [] });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const row = {
    firm_name: typeof o.firm_name === "string" ? o.firm_name.trim() : null,
    contact_name: typeof o.contact_name === "string" ? o.contact_name.trim() : null,
    email: typeof o.email === "string" ? o.email.trim() : null,
    phone: typeof o.phone === "string" ? o.phone.trim() : null,
    firm_size:
      typeof o.firm_size === "number"
        ? o.firm_size
        : typeof o.firm_size === "string" && o.firm_size.trim()
          ? parseInt(o.firm_size, 10) || null
          : null,
    current_tools: typeof o.current_tools === "string" ? o.current_tools.trim() : null,
    estimated_mrr:
      typeof o.estimated_mrr === "number"
        ? o.estimated_mrr
        : typeof o.estimated_mrr === "string" && o.estimated_mrr.trim()
          ? Number(o.estimated_mrr) || null
          : null,
    source: typeof o.source === "string" ? o.source.trim() : null,
    stage: typeof o.stage === "string" ? o.stage.trim() : "Lead",
    notes: typeof o.notes === "string" ? o.notes.trim() : null,
  };

  if (!row.firm_name) {
    return NextResponse.json({ error: "firm_name required" }, { status: 400 });
  }

  const sb = getSupabaseServer();
  if (!sb) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { data, error } = await sb
    .from("prospects")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data?.id });
}
