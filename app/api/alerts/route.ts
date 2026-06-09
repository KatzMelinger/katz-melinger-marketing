/**
 * GET /api/alerts?status=new|read|dismissed&type=...
 *
 * Lists alerts, defaulting to newest-first across all 'new' alerts when no
 * filters are provided.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") ?? "new";
  const type = searchParams.get("type");

  const { supabase } = await getTenantClient();
  let query = supabase
    .from("marketing_alerts")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(200);
  if (status && status !== "all") query = query.eq("status", status);
  if (type) query = query.eq("type", type);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Counters across all statuses for the inbox header.
  const { data: counts } = await supabase
    .from("marketing_alerts")
    .select("status");
  const summary = { new: 0, read: 0, dismissed: 0 };
  for (const c of counts ?? []) {
    const s = c.status as keyof typeof summary;
    if (s in summary) summary[s] += 1;
  }

  return NextResponse.json({ alerts: data ?? [], summary });
}
