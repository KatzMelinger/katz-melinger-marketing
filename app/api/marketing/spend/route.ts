/**
 * Manual marketing-spend entry, backing public.marketing_spend.
 *
 * GET    /api/marketing/spend            — list rows (optional ?since=&until=
 *                                           on period_month, ISO date strings).
 * POST   /api/marketing/spend            — upsert one row by (source, period_month).
 *        Body: { source, period_month, amount, notes? }
 * DELETE /api/marketing/spend?id=UUID    — delete one row.
 *
 * period_month is normalized to the first of the month so a channel has at most
 * one spend figure per month.
 */
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;

/** Coerce any date-ish string to YYYY-MM-01 (first of that month) or null. */
function firstOfMonth(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw.length === 7 ? `${raw}-01T00:00:00Z` : raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function GET(req: NextRequest) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const tid = await resolveTenantId();
  let q = supabase
    .from("marketing_spend")
    .select("id, source, period_month, amount, notes, updated_at")
    .eq("tenant_id", tid)
    .order("period_month", { ascending: false })
    .order("source", { ascending: true });
  const since = firstOfMonth(sp.get("since"));
  const until = firstOfMonth(sp.get("until"));
  if (since) q = q.gte("period_month", since);
  if (until) q = q.lte("period_month", until);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  let body: Json = {};
  try {
    body = (await req.json()) as Json;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });

  const periodMonth = firstOfMonth(body.period_month);
  if (!periodMonth) return NextResponse.json({ error: "valid period_month required" }, { status: 400 });

  const amountRaw = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const amount = Number.isFinite(amountRaw) ? Math.max(0, Math.round(amountRaw * 100) / 100) : 0;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  const { error } = await supabase
    .from("marketing_spend")
    .upsert(
      { source, period_month: periodMonth, amount, notes, updated_at: new Date().toISOString(), tenant_id: await resolveTenantId() },
      { onConflict: "tenant_id,source,period_month" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return GET(req);
}

export async function DELETE(req: NextRequest) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase.from("marketing_spend").delete().eq("tenant_id", await resolveTenantId()).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return GET(req);
}
