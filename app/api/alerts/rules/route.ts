/**
 * GET /api/alerts/rules — list every alert rule
 */

import { NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

export async function GET() {
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("marketing_alert_rules")
    .select("*")
    .order("type", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}
