/**
 * Refresh the monthly report's Instagram demographics from the Meta API.
 *
 * The mirror of lib/linkedin-audience-refresh.ts, and one implementation for
 * the same reason: the probe script and the monthly cron must exercise the same
 * code, or the probe stops being evidence of what the cron does.
 *
 * LinkedIn's half of report_audience is never touched here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchFollowerDemographics,
  metaConfigured,
  resolveIgAccount,
  type IgAccount,
} from "./meta-api";
import { mapInstagramDemographics, type MappedInstagram } from "./meta-audience";

/** Instagram returns no demographics below this follower count. */
export const MIN_FOLLOWERS_FOR_DEMOGRAPHICS = 100;

export type MetaRefreshResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; account: IgAccount; mapped: MappedInstagram }
  | { ok: false; step: string; reason: string };

/** Fetch and map without writing, so a caller can look before it commits. */
export async function buildInstagramAudience(): Promise<MetaRefreshResult> {
  if (!metaConfigured()) {
    return { ok: true, skipped: true, reason: "META_ACCESS_TOKEN is not set" };
  }

  const acct = await resolveIgAccount();
  if (!acct.ok) return { ok: false, step: acct.step, reason: acct.message };

  // Below the threshold Meta answers 200 with nothing in it. Saying so beats
  // storing five empty charts that read as "this account has no audience".
  if (acct.value.followers < MIN_FOLLOWERS_FOR_DEMOGRAPHICS) {
    return {
      ok: true,
      skipped: true,
      reason:
        `@${acct.value.username} has ${acct.value.followers} followers; Instagram returns ` +
        `no demographics below ${MIN_FOLLOWERS_FOR_DEMOGRAPHICS}.`,
    };
  }

  const [ageGender, city, country] = await Promise.all([
    fetchFollowerDemographics(acct.value.igId, "age,gender"),
    fetchFollowerDemographics(acct.value.igId, "city"),
    fetchFollowerDemographics(acct.value.igId, "country"),
  ]);

  // age,gender is the one that carries two of the four distributions, so its
  // failure is fatal where a missing city list is merely a thinner report.
  if (!ageGender.ok) return { ok: false, step: ageGender.step, reason: ageGender.message };

  const mapped = mapInstagramDemographics(
    {
      ageGender: ageGender.value,
      city: city.ok ? city.value : [],
      country: country.ok ? country.value : [],
    },
    acct.value.followers,
  );

  return { ok: true, skipped: false, account: acct.value, mapped };
}

/**
 * Fetch, map, and store.
 *
 * Refuses to write an audience with no rows. Empty breakdowns are what a
 * partial failure looks like, and overwriting good figures with nothing turns a
 * recoverable outage into lost data.
 */
export async function refreshInstagramAudience(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<MetaRefreshResult> {
  const built = await buildInstagramAudience();
  if (!built.ok || built.skipped) return built;

  const a = built.mapped.audience;
  const rows = a.ageGroups.length + a.gender.length + a.topCities.length + a.topCountries.length;
  if (rows === 0) {
    return {
      ok: false,
      step: "store audience",
      reason: "every breakdown came back empty; refusing to overwrite the stored figures",
    };
  }

  // social_insights is keyed by tenant_id and has no id column.
  const { data, error: readErr } = await supabase
    .from("social_insights")
    .select("tenant_id, report_audience")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, step: "read social_insights", reason: readErr.message };
  if (!data) {
    return { ok: false, step: "read social_insights", reason: "no social_insights row for this tenant" };
  }

  const current = ((data as Record<string, unknown>).report_audience ?? {}) as Record<string, unknown>;
  const { error } = await supabase
    .from("social_insights")
    .update({
      report_audience: { ...current, instagram: a },
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
  if (error) return { ok: false, step: "write social_insights", reason: error.message };

  return built;
}
