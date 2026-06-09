/**
 * GET /api/recommendations/history          — list recent generations
 * GET /api/recommendations/history?id=...   — fetch one full set
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantDb } from "@/lib/tenant-db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get("id");
  const db = await getTenantDb();

  if (id) {
    const { data, error } = await db
      .from("recommendations_history")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  }

  const { data, error } = await db
    .from("recommendations_history")
    .select("id, rec_count, evidence, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ history: data ?? [] });
}
