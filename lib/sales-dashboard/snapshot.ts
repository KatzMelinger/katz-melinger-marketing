/**
 * Record Legal Assistant # 1 and Attorney/Reviewer for every not-yet-signed
 * lead, so the dashboard can still credit the right people after Airtable
 * swaps both for matter staff at signing. Rows set by hand on the review page
 * (source = 'manual') are never overwritten. See
 * supabase/intake_staff_snapshots.sql; run hourly by
 * /api/sales-dashboard/snapshot.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_TENANT_ID } from "@/lib/tenant-context";

import { listDashboardIntakes, outcomeOf } from "./intakes";

export async function snapshotIntakeStaff(supabase: SupabaseClient): Promise<{ leads: number; snapshotted: number }> {
  const leads = await listDashboardIntakes({ fresh: true });
  const now = new Date().toISOString();
  const { data: manual, error: mErr } = await supabase
    .from("intake_staff_snapshots")
    .select("airtable_id")
    .eq("tenant_id", DEFAULT_TENANT_ID)
    .eq("source", "manual");
  if (mErr) throw new Error(mErr.message);
  const manualIds = new Set((manual ?? []).map((r) => r.airtable_id as string));

  // The Airtable intake base belongs to the default tenant (Katz Melinger).
  const rows = leads
    .filter((l) => outcomeOf(l.status) !== "signed" && !manualIds.has(l.id))
    .map((l) => ({
      tenant_id: DEFAULT_TENANT_ID,
      airtable_id: l.id,
      legal_assistant: l.legalAssistant,
      reviewer: l.reviewer,
      source: "snapshot",
      observed_at: now,
    }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("intake_staff_snapshots")
      .upsert(rows.slice(i, i + 500), { onConflict: "tenant_id,airtable_id" });
    if (error) throw new Error(error.message);
  }
  return { leads: leads.length, snapshotted: rows.length };
}
