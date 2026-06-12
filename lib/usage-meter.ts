/**
 * Provider-agnostic usage meter + monthly quota.
 *
 * This is the cost-control spine for any feature that spends the OWNER's shared
 * external-API budget on behalf of a tenant (today: DataForSEO competitor-ad
 * lookups via the SERP API). Every billable call is recorded in
 * external_api_usage and checked against a per-tenant monthly cap in
 * tenant_usage_limits BEFORE it fires.
 *
 * Conventions match the rest of the app:
 *   - Service-role client, explicitly scoped/stamped by tenant_id (this runs in
 *     both request and cron contexts, so we can't rely on RLS).
 *   - recordUsage is best-effort: a ledger write must never fail the user's
 *     request. assertWithinQuota, by contrast, is a hard gate and DOES throw.
 *
 * See supabase/competitor_intel_schema.sql.
 */

import { getSupabaseAdmin } from "./supabase-server";

export type Meter = "competitor_lookup";

/** Default monthly cap seeded when a tenant has no explicit limit row. */
export const DEFAULT_MONTHLY_CAP: Record<Meter, number> = {
  competitor_lookup: 100,
};

export class QuotaExceededError extends Error {
  readonly meter: Meter;
  readonly used: number;
  readonly cap: number;
  constructor(meter: Meter, used: number, cap: number) {
    super(`Monthly limit reached for ${meter}: ${used}/${cap} used this month.`);
    this.name = "QuotaExceededError";
    this.meter = meter;
    this.used = used;
    this.cap = cap;
  }
}

/** First instant of the current calendar month, UTC, as an ISO string. */
function monthStartISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Billable units this tenant has consumed for `meter` so far this month. */
export async function getMonthlyUsage(tenantId: string, meter: Meter): Promise<number> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("external_api_usage")
      .select("units")
      .eq("tenant_id", tenantId)
      .eq("meter", meter)
      .gte("created_at", monthStartISO());
    if (error || !data) return 0;
    return data.reduce((sum, r) => sum + (Number((r as { units: number }).units) || 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Monthly cap for this tenant + meter. Reads tenant_usage_limits; lazily seeds
 * a default-cap row the first time a tenant touches a meter (so the limit is
 * visible/editable in the DB afterwards). Falls back to the in-code default if
 * the table is missing or the seed write fails.
 */
export async function getQuota(tenantId: string, meter: Meter): Promise<number> {
  const fallback = DEFAULT_MONTHLY_CAP[meter] ?? 0;
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("tenant_usage_limits")
      .select("monthly_cap")
      .eq("tenant_id", tenantId)
      .eq("meter", meter)
      .maybeSingle();
    if (data && typeof (data as { monthly_cap: number }).monthly_cap === "number") {
      return (data as { monthly_cap: number }).monthly_cap;
    }
    // Seed the default so it's discoverable/editable later. Best-effort.
    await supabase
      .from("tenant_usage_limits")
      .upsert(
        { tenant_id: tenantId, meter, monthly_cap: fallback },
        { onConflict: "tenant_id,meter" },
      );
    return fallback;
  } catch {
    return fallback;
  }
}

export type UsageSummary = { used: number; cap: number; remaining: number };

/** Current-month usage + cap for the tab's meter display. */
export async function getUsageSummary(tenantId: string, meter: Meter): Promise<UsageSummary> {
  const [used, cap] = await Promise.all([getMonthlyUsage(tenantId, meter), getQuota(tenantId, meter)]);
  return { used, cap, remaining: Math.max(0, cap - used) };
}

/**
 * Hard gate: throw QuotaExceededError when this tenant has hit its cap for the
 * month. Call this BEFORE every billable external request.
 */
export async function assertWithinQuota(tenantId: string, meter: Meter): Promise<void> {
  const { used, cap } = await getUsageSummary(tenantId, meter);
  if (used >= cap) throw new QuotaExceededError(meter, used, cap);
}

/**
 * Record one metered call. Best-effort — never throws (a ledger failure must
 * not break the user flow). A cache hit should pass units=0 so it doesn't burn
 * the tenant's quota.
 */
export async function recordUsage(input: {
  tenantId: string;
  provider: string;
  endpoint: string;
  meter: Meter;
  units?: number;
  estCostCents?: number;
  cacheHit?: boolean;
  detail?: string;
}): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("external_api_usage").insert({
      tenant_id: input.tenantId,
      provider: input.provider,
      endpoint: input.endpoint,
      meter: input.meter,
      units: input.units ?? 1,
      est_cost_cents: input.estCostCents ?? 0,
      cache_hit: input.cacheHit ?? false,
      detail: input.detail ?? null,
    });
  } catch (err) {
    console.warn("[usage-meter] ledger write failed:", err);
  }
}
