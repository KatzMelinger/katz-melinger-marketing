/**
 * Tenant-editable readability thresholds — CRUD + resolve.
 *
 * Tenant-scoped: reads auto-scope via RLS (getTenantClient), writes stamp
 * tenant_id. getThresholds() always returns a full set (tenant config deep-
 * merged over DEFAULT_THRESHOLDS), so callers never see a partial config.
 *
 * Request-context only (getTenantClient relies on the user session). The
 * analysis engine calls getThresholds() once per run from inside a route.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getTenantClient } from "@/lib/tenant-db";
import {
  DEFAULT_THRESHOLDS,
  mergeThresholds,
  type ReadabilityMetric,
  type ReadabilityThresholds,
} from "./config";

type StoredConfig = Partial<
  Record<ReadabilityMetric, { green?: number; amber?: number } | null>
>;

/** Resolved thresholds for the current tenant (defaults if no row/empty). */
export async function getThresholds(): Promise<ReadabilityThresholds> {
  const { supabase } = await getTenantClient();
  const { data, error } = await supabase
    .from("readability_thresholds")
    .select("config")
    .maybeSingle();
  // Non-fatal: fall back to code defaults so analysis never breaks on a read.
  if (error) {
    console.warn("[readability] getThresholds read failed, using defaults:", error.message);
    return DEFAULT_THRESHOLDS;
  }
  return mergeThresholds((data?.config ?? null) as StoredConfig | null);
}

/**
 * Resolve thresholds for an explicit tenant using a caller-supplied client.
 * For background / admin contexts (e.g. analyzeDraft via after()) that already
 * hold a service-role client + tenantId and can't rely on RLS auto-scoping.
 */
export async function getThresholdsForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ReadabilityThresholds> {
  const { data, error } = await supabase
    .from("readability_thresholds")
    .select("config")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    console.warn("[readability] getThresholdsForTenant failed, using defaults:", error.message);
    return DEFAULT_THRESHOLDS;
  }
  return mergeThresholds((data?.config ?? null) as StoredConfig | null);
}

/**
 * Persist a partial edit. Merges the patch over the tenant's current resolved
 * values and upserts the full set, so the stored row is always complete.
 * Returns the new resolved thresholds.
 */
export async function saveThresholds(
  patch: Partial<Record<ReadabilityMetric, { green?: number; amber?: number }>>,
): Promise<ReadabilityThresholds> {
  const { supabase, tenantId } = await getTenantClient();
  const current = await getThresholds();
  const next = mergeThresholds({ ...current, ...patch });
  const { error } = await supabase
    .from("readability_thresholds")
    .upsert(
      { tenant_id: tenantId, config: next, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id" },
    );
  if (error) throw new Error(error.message);
  return next;
}

/** Clear a tenant's overrides; subsequent reads return the code defaults. */
export async function resetThresholds(): Promise<ReadabilityThresholds> {
  const { supabase, tenantId } = await getTenantClient();
  const { error } = await supabase
    .from("readability_thresholds")
    .delete()
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return DEFAULT_THRESHOLDS;
}
