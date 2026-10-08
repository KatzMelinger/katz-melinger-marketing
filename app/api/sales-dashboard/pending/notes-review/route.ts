/**
 * POST /api/sales-dashboard/pending/notes-review { ids: string[] } — AI
 * staleness read of Follow-Up Notes (lib/sales-dashboard/notes-ai-review) for
 * a specific set of Pending Intakes rows. Called on demand from the Pending
 * Intakes page for whatever's currently in view, not on every load.
 * Admins, or Bearer SALES_DASHBOARD_API_KEY.
 */
import { NextResponse } from "next/server";

import { guardDashboard } from "@/lib/sales-dashboard/access";
import { loadDashboardContext } from "@/lib/sales-dashboard/metrics";
import { reviewNotesForStaleness } from "@/lib/sales-dashboard/notes-ai-review";
import { buildPendingReport } from "@/lib/sales-dashboard/pending";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IDS = 75;

export async function POST(req: Request) {
  const access = await guardDashboard(req);
  if (access.denied) return access.denied;

  let ids: unknown;
  try {
    ({ ids } = await req.json());
  } catch {
    return NextResponse.json({ error: "Expected JSON body with an ids array" }, { status: 400 });
  }
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string") || ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty string array" }, { status: 400 });
  }
  const wanted = new Set(ids.slice(0, MAX_IDS));

  const supabase = getSupabaseAdmin();
  try {
    const ctx = await loadDashboardContext(supabase, access.tenantId);
    const notesById = new Map(ctx.leads.map((l) => [l.id, l.followUpNotes ?? ""]));
    const rows = buildPendingReport(ctx.leads).filter((r) => wanted.has(r.id));

    const flags = await reviewNotesForStaleness(
      rows.map((r) => ({
        id: r.id,
        notes: notesById.get(r.id) ?? "",
        daysOld: r.daysOld,
        daysSinceModified: r.daysSinceModified,
      })),
    );
    return NextResponse.json({ flags });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
