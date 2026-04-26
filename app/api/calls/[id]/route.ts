/**
 * GET /api/calls/[id] — single call with most recent score (if any).
 */
import { NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const [callQ, scoreQ] = await Promise.all([
    supabase.from("calls").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("call_scores")
      .select("*")
      .eq("call_id", id)
      .order("scored_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (callQ.error) return NextResponse.json({ error: callQ.error.message }, { status: 500 });
  if (!callQ.data) return NextResponse.json({ error: "call not found" }, { status: 404 });

  return NextResponse.json({ call: callQ.data, score: scoreQ.data ?? null });
}
