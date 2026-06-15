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
import { resolveTenantId } from "./tenant-context";

// Meters track the OWNER's shared paid-API spend per tenant (reseller model:
// firms pay us and use our vendor accounts). "competitor_lookup" hard-gates
// DataForSEO SERP. The vendor meters below are Phase-1 ADVISORY — recorded for
// per-tenant cost visibility, NOT enforced as caps yet.
export type Meter = "competitor_lookup" | "dataforseo" | "anthropic" | "ayrshare";

/** Default monthly cap seeded when a tenant has no explicit limit row.
 *  Advisory meters use a high placeholder cap (not enforced in Phase 1). */
export const DEFAULT_MONTHLY_CAP: Record<Meter, number> = {
  competitor_lookup: 100,
  dataforseo: 1_000_000,
  anthropic: 1_000_000,
  ayrshare: 100_000,
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

/**
 * Billable units this tenant has consumed for `meter` so far this month.
 *
 * Returns 0 on read failure so the usage DISPLAY degrades gracefully — but logs
 * it, since a silent 0 is misleading. This is NOT the hard cost gate: the
 * authoritative, fail-closed gate is consumeUsageUnit (consume_api_unit), which
 * counts under a row lock and throws rather than reporting a false 0.
 */
export async function getMonthlyUsage(tenantId: string, meter: Meter): Promise<number> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("external_api_usage")
      .select("units")
      .eq("tenant_id", tenantId)
      .eq("meter", meter)
      .gte("created_at", monthStartISO());
    if (error || !data) {
      if (error) console.warn("[usage-meter] usage read failed; reporting 0:", error.message);
      return 0;
    }
    return data.reduce((sum, r) => sum + (Number((r as { units: number }).units) || 0), 0);
  } catch (err) {
    console.warn("[usage-meter] usage read threw; reporting 0:", err);
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
 * month.
 *
 * NOTE: this is a non-atomic check (SELECT + compare). For a BILLABLE request,
 * prefer consumeUsageUnit, which reserves a unit under a DB row-lock so
 * concurrent callers can't both pass the gate and overshoot the cap. Keep using
 * this only for a cheap advisory pre-check.
 */
export async function assertWithinQuota(tenantId: string, meter: Meter): Promise<void> {
  const { used, cap } = await getUsageSummary(tenantId, meter);
  if (used >= cap) throw new QuotaExceededError(meter, used, cap);
}

export type ConsumeResult = {
  allowed: boolean;
  used: number;
  cap: number;
  /** Ledger row id of the reserved unit; pass to release/markCacheHit to undo. */
  usageId: string | null;
};

/**
 * Atomically reserve ONE billable unit if the tenant is within its monthly cap,
 * via the consume_api_unit SQL function (row-locked count + insert). Use this
 * BEFORE firing a billable external request: it both gates and records in one
 * race-free step, replacing the old assertWithinQuota-then-recordUsage pattern.
 *
 * If the request then turns out free (cache hit) or fails, undo the reservation
 * with markReservationCacheHit / releaseUsageUnit so it doesn't burn quota.
 *
 * Fails CLOSED: if the meter RPC errors, this throws rather than silently
 * allowing the spend (the meter is a cost gate, not best-effort like recording).
 */
export async function consumeUsageUnit(input: {
  tenantId: string;
  meter: Meter;
  provider: string;
  endpoint: string;
  estCostCents?: number;
  detail?: string;
}): Promise<ConsumeResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("consume_api_unit", {
    p_tenant: input.tenantId,
    p_meter: input.meter,
    p_default_cap: DEFAULT_MONTHLY_CAP[input.meter] ?? 0,
    p_provider: input.provider,
    p_endpoint: input.endpoint,
    p_units: 1,
    p_est_cost_cents: input.estCostCents ?? 0,
    p_detail: input.detail ?? null,
  });
  if (error) throw new Error(`usage meter unavailable: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { allowed: boolean; used: number; cap: number; usage_id: string | null }
    | undefined;
  return {
    allowed: Boolean(row?.allowed),
    used: Number(row?.used ?? 0),
    cap: Number(row?.cap ?? (DEFAULT_MONTHLY_CAP[input.meter] ?? 0)),
    usageId: row?.usage_id ?? null,
  };
}

/**
 * Refund a reserved unit entirely (best-effort). Use when the reserved call was
 * never billable — e.g. it threw before producing a result.
 */
export async function releaseUsageUnit(usageId: string | null): Promise<void> {
  if (!usageId) return;
  try {
    await getSupabaseAdmin().from("external_api_usage").delete().eq("id", usageId);
  } catch (err) {
    console.warn("[usage-meter] unit release failed:", err);
  }
}

/**
 * Downgrade a reserved unit to a non-billable cache-hit trace (units→0). Use
 * when the reserved call was served from cache: keep the ledger row for
 * visibility, but don't let it count against the cap.
 */
export async function markReservationCacheHit(usageId: string | null): Promise<void> {
  if (!usageId) return;
  try {
    await getSupabaseAdmin()
      .from("external_api_usage")
      .update({ units: 0, est_cost_cents: 0, cache_hit: true })
      .eq("id", usageId);
  } catch (err) {
    console.warn("[usage-meter] cache-hit downgrade failed:", err);
  }
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

/**
 * ADVISORY per-tenant usage recording for the owner's shared vendor accounts
 * (reseller model). Resolves the tenant best-effort and writes to the ledger.
 * Fully best-effort: never throws, never blocks the caller. In cron/no-request
 * contexts the tenant resolves to the default tenant — a known Phase-1 limitation
 * (cron-driven usage is mis-attributed until we thread tenantId through).
 */
export async function recordVendorUsage(
  meter: Meter,
  input: {
    provider: string;
    endpoint: string;
    units?: number;
    cacheHit?: boolean;
    detail?: string;
    tenantId?: string;
  },
): Promise<void> {
  try {
    const tenantId = input.tenantId ?? (await resolveTenantId());
    await recordUsage({
      tenantId,
      provider: input.provider,
      endpoint: input.endpoint,
      meter,
      units: input.units,
      cacheHit: input.cacheHit,
      detail: input.detail,
    });
  } catch (err) {
    console.warn("[usage-meter] vendor usage record failed:", err);
  }
}
