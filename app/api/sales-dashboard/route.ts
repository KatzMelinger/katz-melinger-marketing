/**
 * GET /api/sales-dashboard?from=&to=&category=&source= — Intake & Sales
 * dashboard (lib/sales-dashboard). Admins, or Bearer SALES_DASHBOARD_API_KEY.
 */
import { NextResponse } from "next/server";

import { filtersFrom, guardDashboard } from "@/lib/sales-dashboard/access";
import { buildDashboard, loadDashboardContext, loadScoredCalls } from "@/lib/sales-dashboard/metrics";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const access = await guardDashboard(req);
  if (access.denied) return access.denied;
  const supabase = getSupabaseAdmin();
  const filters = filtersFrom(new URL(req.url));
  try {
    const [ctx, scored] = await Promise.all([
      loadDashboardContext(supabase, access.tenantId),
      loadScoredCalls(supabase, access.tenantId, filters),
    ]);
    return NextResponse.json(buildDashboard(ctx, filters, scored));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
