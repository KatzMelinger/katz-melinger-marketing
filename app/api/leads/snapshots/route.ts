/**
 * GET /api/leads/snapshots — lead-response trend history for the current
 * tenant (most recent ~26 weeks), oldest→newest, for the dashboard sparkline.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ snapshots: [] });
  const tid = await resolveTenantId();
  const { data, error } = await supabase
    .from("lead_response_snapshots")
    .select("snapshot_date, window_days, lost, recovered, missed_first_contact, connect_rate_pct, estimated_lost_value")
    .eq("tenant_id", tid)
    .eq("window_days", 30)
    .order("snapshot_date", { ascending: false })
    .limit(26);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Return oldest→newest for left-to-right charting.
  return NextResponse.json({ snapshots: (data ?? []).reverse() });
}
