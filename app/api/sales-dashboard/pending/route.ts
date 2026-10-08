/**
 * GET /api/sales-dashboard/pending — Pending Intakes report (lib/sales-dashboard/pending).
 * Current state, not date-ranged: every open intake, any creation date.
 * Admins, or Bearer SALES_DASHBOARD_API_KEY.
 */
import { NextResponse } from "next/server";

import { guardDashboard } from "@/lib/sales-dashboard/access";
import { loadDashboardContext } from "@/lib/sales-dashboard/metrics";
import { buildPendingReport } from "@/lib/sales-dashboard/pending";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const access = await guardDashboard(req);
  if (access.denied) return access.denied;
  const supabase = getSupabaseAdmin();
  try {
    const ctx = await loadDashboardContext(supabase, access.tenantId);
    const rows = buildPendingReport(ctx.leads);
    return NextResponse.json({
      rows,
      options: {
        categories: [...new Set(ctx.leads.map((l) => l.category ?? "(none)"))].sort(),
        sources: [...new Set(ctx.leads.map((l) => l.source ?? "(none)"))].sort(),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
