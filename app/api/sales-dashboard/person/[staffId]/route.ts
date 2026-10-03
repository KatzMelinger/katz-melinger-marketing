/**
 * GET /api/sales-dashboard/person/[staffId]?from=&to= — one team member's
 * lead numbers and call scores (lib/sales-dashboard/person.ts).
 * Admins, or Bearer SALES_DASHBOARD_API_KEY.
 */
import { NextResponse } from "next/server";

import { filtersFrom, guardDashboard } from "@/lib/sales-dashboard/access";
import { loadDashboardContext, loadScoredCalls } from "@/lib/sales-dashboard/metrics";
import { buildPerson } from "@/lib/sales-dashboard/person";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ staffId: string }> }) {
  const access = await guardDashboard(req);
  if (access.denied) return access.denied;
  const { staffId } = await ctx.params;
  const supabase = getSupabaseAdmin();
  const filters = { ...filtersFrom(new URL(req.url)), category: null, source: null };
  try {
    const [context, scored] = await Promise.all([
      loadDashboardContext(supabase, access.tenantId),
      loadScoredCalls(supabase, access.tenantId, filters),
    ]);
    const person = buildPerson(context, staffId, filters, scored);
    if (!person) return NextResponse.json({ error: "staff member not found" }, { status: 404 });
    return NextResponse.json(person);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
