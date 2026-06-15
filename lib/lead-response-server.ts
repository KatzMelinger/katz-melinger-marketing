/**
 * Server-side glue for lead-response: pulls calls + practice-area economics for
 * a tenant and runs the pure analyzer. Shared by the live leakage API and the
 * weekly snapshot cron so both compute identically.
 */

import { DEFAULT_TZ, analyzeLeadResponse, type LeadCall, type LeadResponseReport } from "@/lib/lead-response";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_AVG_CASE_VALUE = 7500;
const DEFAULT_SIGN_RATE = 0.25;

/** Offset of `tz` from UTC (ms) at a given instant; positive = ahead of UTC. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUTC - utcMs;
}

/**
 * Exclusive upper bound (UTC ISO) for a YYYY-MM-DD firm-local day: the instant
 * of the *next* day's local midnight. Using this as a `< bound` filter includes
 * the whole final local day (e.g. 8pm–midnight NY calls), which a naive
 * `${date}T23:59:59` UTC bound would clip — the analyzer buckets in firm-local
 * time, so the query window must too.
 */
function firmLocalDayEndExclusiveUTC(dateStr: string, tz: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const naiveNextMidnight = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  return new Date(naiveNextMidnight - tzOffsetMs(naiveNextMidnight, tz)).toISOString();
}

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
  if (opts.untilDate) {
    q = q.lt("start_time", firmLocalDayEndExclusiveUTC(opts.untilDate, DEFAULT_TZ));
  }

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
