/**
 * Server-side glue for lead-response: pulls calls + practice-area economics for
 * a tenant and runs the pure analyzer. Shared by the live leakage API and the
 * weekly snapshot cron so both compute identically.
 */

import { analyzeLeadResponse, type LeadCall, type LeadResponseReport } from "@/lib/lead-response";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_AVG_CASE_VALUE = 7500;
const DEFAULT_SIGN_RATE = 0.25;

export type ComputeOptions = {
  /** ISO timestamp; leads whose first contact is on/after this are included. */
  sinceISO: string;
  /** YYYY-MM-DD upper bound (inclusive), or null for "up to now". */
  untilDate?: string | null;
  avgCaseValueOverride?: number | null;
  signRateOverride?: number | null;
};

export async function resolveEconomics(
  supabase: SupabaseClient,
  tenantId: string,
  overrideValue: number | null | undefined,
  overrideRate: number | null | undefined,
): Promise<{ avgCaseValue: number; expectedSignRate: number }> {
  let avg = DEFAULT_AVG_CASE_VALUE;
  let rate = DEFAULT_SIGN_RATE;
  const { data } = await supabase
    .from("ad_economics")
    .select("avg_case_value, close_rate")
    .eq("tenant_id", tenantId);
  const rows = (data ?? []) as Array<{ avg_case_value: number | null; close_rate: number | null }>;
  const values = rows.map((r) => Number(r.avg_case_value)).filter((n) => Number.isFinite(n) && n > 0);
  const rates = rows.map((r) => Number(r.close_rate)).filter((n) => Number.isFinite(n) && n > 0);
  if (values.length) avg = values.reduce((s, n) => s + n, 0) / values.length;
  if (rates.length) {
    const r = rates.reduce((s, n) => s + n, 0) / rates.length;
    // close_rate may be stored as a percentage (e.g. 30) or a fraction (0.3).
    rate = r > 1 ? r / 100 : r;
  }
  return {
    avgCaseValue: overrideValue ?? avg,
    expectedSignRate: overrideRate ?? rate,
  };
}

export async function computeLeadResponse(
  supabase: SupabaseClient,
  tenantId: string,
  opts: ComputeOptions,
): Promise<LeadResponseReport> {
  let q = supabase
    .from("calls")
    .select("id, customer_phone_number, source_name, duration, answered, voicemail, first_call, direction, start_time")
    .eq("tenant_id", tenantId)
    .gte("start_time", opts.sinceISO)
    .order("start_time", { ascending: true })
    .limit(10000);
  if (opts.untilDate) q = q.lte("start_time", `${opts.untilDate}T23:59:59`);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const { avgCaseValue, expectedSignRate } = await resolveEconomics(
    supabase,
    tenantId,
    opts.avgCaseValueOverride,
    opts.signRateOverride,
  );

  return analyzeLeadResponse((data ?? []) as LeadCall[], { avgCaseValue, expectedSignRate });
}
