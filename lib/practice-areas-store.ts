/**
 * Server-only accessor for the DB-backed practice-area list.
 *
 * Split out of lib/practice-areas.ts because that module's constants are
 * imported by client components — pulling next/headers (via resolveTenantId)
 * into it would break the Turbopack build. Keep all server/DB code here.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";
import { DEFAULT_PRACTICE_AREAS } from "./practice-areas";

/**
 * Live practice-area labels in display order for a tenant. Falls back to
 * DEFAULT_PRACTICE_AREAS when the table is empty or unreachable, so callers
 * never get an empty dropdown. Pass an explicit tenantId in background/cron
 * contexts; otherwise it resolves the session tenant.
 */
export async function getPracticeAreas(tenantId?: string): Promise<string[]> {
  try {
    const tid = tenantId ?? (await resolveTenantId());
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("practice_areas")
      .select("label")
      .eq("tenant_id", tid)
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) return [...DEFAULT_PRACTICE_AREAS];
    const labels = data
      .map((r) => (typeof r.label === "string" ? r.label.trim() : ""))
      .filter(Boolean);
    return labels.length > 0 ? labels : [...DEFAULT_PRACTICE_AREAS];
  } catch {
    return [...DEFAULT_PRACTICE_AREAS];
  }
}
