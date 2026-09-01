/**
 * Refresh the monthly report's LinkedIn demographics from the API.
 *
 * ONE implementation, called by both the monthly cron and
 * scripts/check-linkedin.ts. They existed as separate code for about an hour and
 * that was already long enough to notice the risk: the script is what anyone
 * runs to see whether the integration works, so if it diverges from what the
 * cron actually does, it stops being evidence of anything.
 *
 * Instagram's half of report_audience is hand-entered and is never touched here.
 * Only the LinkedIn half has a source to replace it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchFollowerCount,
  fetchFollowerStatistics,
  fetchGeoLabels,
  fetchLabelMap,
  linkedInConfigured,
  resolveOrganizationUrn,
  urnId,
} from "./linkedin-api";
import { mapFollowerStatistics, type MappedAudience } from "./linkedin-audience";

export type RefreshResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; followers: number | null; mapped: MappedAudience }
  | { ok: false; step: string; reason: string };

/** Followers in one bucket row, organic plus paid. */
function bucketSize(b: Record<string, unknown>): number {
  const c = (b.followerCounts ?? {}) as { organicFollowerCount?: number; paidFollowerCount?: number };
  return (c.organicFollowerCount ?? 0) + (c.paidFollowerCount ?? 0);
}

/**
 * Fetch and map, without writing. Separated so a caller can look before it
 * commits — which is what the probe script does.
 */
export async function buildLinkedInAudience(): Promise<RefreshResult> {
  if (!linkedInConfigured()) {
    return { ok: true, skipped: true, reason: "LINKEDIN_ACCESS_TOKEN is not set" };
  }

  const org = await resolveOrganizationUrn();
  if (!org.ok) return { ok: false, step: org.step, reason: org.message };

  const stats = await fetchFollowerStatistics(org.value);
  if (!stats.ok) return { ok: false, step: stats.step, reason: stats.message };

  // The follower total is nice to have, not required. Losing it costs the
  // coverage percentages, not the breakdowns, so it must not fail the refresh.
  const count = await fetchFollowerCount(org.value);
  const followers = count.ok ? count.value : null;

  const [functions, seniorities, industries] = await Promise.all([
    fetchLabelMap("functions"),
    fetchLabelMap("seniorities"),
    fetchLabelMap("industries"),
  ]);

  // Only the rows that will be displayed. The location breakdown has a hundred
  // entries and the report shows nine, and /geo has a daily quota — resolving
  // all hundred spends it on labels nobody sees.
  const geoBuckets = (stats.value.followerCountsByGeo ??
    stats.value.followerCountsByGeoCountry ??
    []) as Record<string, unknown>[];
  const topGeoIds = [...geoBuckets]
    .sort((a, b) => bucketSize(b) - bucketSize(a))
    .slice(0, 12)
    .map((b) => urnId(String(b.geo ?? "")));
  const geo = await fetchGeoLabels(topGeoIds);

  const mapped = mapFollowerStatistics(stats.value, followers, {
    functions: functions.ok ? functions.value : undefined,
    seniorities: seniorities.ok ? seniorities.value : undefined,
    industries: industries.ok ? industries.value : undefined,
    geo,
  });

  return { ok: true, skipped: false, followers, mapped };
}

/**
 * Fetch, map, and store.
 *
 * Refuses to write an audience with no rows in it. An empty breakdown is what a
 * partial API failure looks like, and overwriting good numbers with nothing
 * would turn a recoverable outage into lost data — the report would show blank
 * charts and there would be no way to tell that from a page with no followers.
 */
export async function refreshLinkedInAudience(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<RefreshResult> {
  const built = await buildLinkedInAudience();
  if (!built.ok || built.skipped) return built;

  const { audience } = built.mapped;
  const rows =
    audience.jobFunction.length +
    audience.seniority.length +
    audience.industry.length +
    audience.companySize.length +
    audience.location.length;
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
      report_audience: { ...current, linkedin: audience },
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
  if (error) return { ok: false, step: "write social_insights", reason: error.message };

  return built;
}
