/**
 * Server-only accessor for the DB-backed content-pillar list.
 *
 * Pillars live in tenant_settings.pillars (JSONB). This resolves the live list
 * for a tenant, falling back to the code-defined ALL_KM_PILLARS whenever the
 * column is null/empty or the DB is unreachable — so the grouper, link plan,
 * cluster map, and brief never get an empty list.
 *
 * Split out of km-content-system.ts (which is client-safe) because this pulls
 * in supabase + next/headers (via resolveTenantId), which must stay server-only.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";
import { ALL_KM_PILLARS, normalizePillar, type KMPillar } from "./km-content-system";

/**
 * Live pillars for a tenant, in stored order. Falls back to the code default.
 * Pass an explicit tenantId in background/cron contexts; otherwise it resolves
 * the session tenant.
 */
export async function getPillars(tenantId?: string): Promise<KMPillar[]> {
  try {
    const tid = tenantId ?? (await resolveTenantId());
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("tenant_settings")
      .select("pillars")
      .eq("tenant_id", tid)
      .maybeSingle();
    if (error || !data) return [...ALL_KM_PILLARS];
    const raw = (data as { pillars?: unknown }).pillars;
    if (Array.isArray(raw) && raw.length > 0) {
      const out = raw.map(normalizePillar).filter((p): p is KMPillar => p !== null);
      if (out.length > 0) return out;
    }
    return [...ALL_KM_PILLARS];
  } catch {
    return [...ALL_KM_PILLARS];
  }
}

/**
 * Replace the whole pillar list for a tenant. Upserts the tenant_settings row
 * so it works even before the row exists. Throws on DB error.
 */
export async function savePillars(
  pillars: KMPillar[],
  tenantId?: string,
): Promise<KMPillar[]> {
  const tid = tenantId ?? (await resolveTenantId());
  const cleaned = pillars
    .map(normalizePillar)
    .filter((p): p is KMPillar => p !== null);
  // De-dupe by id, last wins.
  const byId = new Map<string, KMPillar>();
  for (const p of cleaned) byId.set(p.id, p);
  const out = Array.from(byId.values());

  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("tenant_settings")
    .upsert({ tenant_id: tid, pillars: out }, { onConflict: "tenant_id" });
  if (error) throw new Error(error.message);
  return out;
}
