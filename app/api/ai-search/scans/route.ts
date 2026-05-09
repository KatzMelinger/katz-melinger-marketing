/**
 * GET /api/ai-search/scans            — list recent scans
 * GET /api/ai-search/scans?id=...     — fetch one full scan (crawl + analysis)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get("id");
  const supabase = getSupabaseAdmin();

  if (id) {
    const { data, error } = await supabase
      .from("ai_search_scans")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from("ai_search_scans")
    .select("id, domain, base_url, overall_score, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ scans: data ?? [] });
}
