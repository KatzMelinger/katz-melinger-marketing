/**
 * Tenant-scoped data access — the safe way to read/write firm data.
 *
 * Two contexts, two helpers:
 *
 *  • getTenantDb()  — REQUEST context (a logged-in user). Uses the authenticated
 *    client, so the DATABASE enforces tenant isolation via RLS: reads return
 *    only the caller's tenant rows even if you forget a filter, and writes are
 *    auto-stamped with the tenant_id (RLS with-check rejects anything else).
 *    This is the default — prefer it for any route that serves a logged-in user.
 *
 *  • getTenantJobDb(tenantId) — BACKGROUND/CRON context (no logged-in user).
 *    Uses the service-role client, which BYPASSES RLS, so isolation is the
 *    caller's responsibility: reads are pre-filtered to the tenant and writes
 *    are stamped. Always pass an explicit tenantId (loop the tenants table).
 *
 * New features: use getTenantDb() in user-facing routes and you don't have to
 * remember tenant filters/stamps — the helper + RLS handle it.
 */

import { getSupabaseRouteClient } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

type Row = Record<string, unknown>;
const stampWith =
  (tenantId: string) =>
  <T extends Row>(r: T) => ({ ...r, tenant_id: tenantId });

/** Request-scoped, RLS-enforced data access for the logged-in user's tenant. */
export async function getTenantDb() {
  const supabase = await getSupabaseRouteClient();
  const tenantId = await resolveTenantId();
  const stamp = stampWith(tenantId);
  return {
    tenantId,
    /** RLS-scoped query builder — reads return ONLY this tenant's rows. */
    from: (table: string) => supabase.from(table),
    /** Insert, tenant_id stamped on every row. */
    insert: (table: string, rows: Row | Row[]) =>
      supabase.from(table).insert(Array.isArray(rows) ? rows.map(stamp) : stamp(rows)),
    /** Upsert, tenant_id stamped on every row. onConflict should include tenant_id. */
    upsert: (table: string, rows: Row | Row[], opts?: { onConflict?: string }) =>
      supabase.from(table).upsert(Array.isArray(rows) ? rows.map(stamp) : stamp(rows), opts),
  };
}

/** Service-role data access for a SPECIFIC tenant (crons/jobs). RLS is bypassed,
 *  so reads are pre-filtered and writes stamped here in code. */
export function getTenantJobDb(tenantId: string) {
  const supabase = getSupabaseAdmin();
  const stamp = stampWith(tenantId);
  return {
    tenantId,
    /** Read builder pre-filtered to this tenant. Chain further .eq/.in/etc. */
    select: (table: string, columns = "*") =>
      supabase.from(table).select(columns).eq("tenant_id", tenantId),
    insert: (table: string, rows: Row | Row[]) =>
      supabase.from(table).insert(Array.isArray(rows) ? rows.map(stamp) : stamp(rows)),
    upsert: (table: string, rows: Row | Row[], opts?: { onConflict?: string }) =>
      supabase.from(table).upsert(Array.isArray(rows) ? rows.map(stamp) : stamp(rows), opts),
    /** Escape hatch to the raw service-role client (remember to scope by tenant). */
    raw: supabase,
  };
}

/** Every active tenant id — for crons that must process all firms. */
export async function listTenantIds(): Promise<string[]> {
  const { data } = await getSupabaseAdmin()
    .from("tenants")
    .select("id")
    .eq("status", "active");
  return (data ?? []).map((t) => t.id as string);
}
