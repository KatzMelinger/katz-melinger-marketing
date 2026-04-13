import { NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Params) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const patch: Record<string, unknown> = {};

  if (typeof o.stage === "string" && o.stage.trim()) {
    patch.stage = o.stage.trim();
  }
  if (typeof o.estimated_mrr === "number") patch.estimated_mrr = o.estimated_mrr;
  if (typeof o.notes === "string") patch.notes = o.notes;
  if (typeof o.trial_firm_id === "string") patch.trial_firm_id = o.trial_firm_id || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  const sb = getSupabaseServer();
  if (!sb) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  const { error } = await sb.from("prospects").update(patch).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
