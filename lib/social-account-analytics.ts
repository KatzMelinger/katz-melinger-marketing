/**
 * Account-level social analytics (Part 4B).
 *
 * Companion to lib/social-metrics.ts: that file refreshes metrics for individual
 * posts, this one pulls the whole-account totals (followers, reach, engagement)
 * that the KPI screen and the monthly report show. Source is Ayrshare's
 * /api/analytics/social, so no Meta App Review is involved.
 *
 * Snapshots land in social_insights.account_analytics, keyed by platform, with
 * the fetch timestamp. Behind NATIVE_SOCIAL_ANALYTICS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAyrshareApiKey, getAyrshareSocialAnalytics, type AccountMetrics } from "./ayrshare";
import { nativeSocialAnalyticsEnabled } from "./feature-flags";
import { logger } from "./logger";
import { getTenantConfig } from "./tenant-config";

/** Platforms we pull account analytics for. X was dropped from the module. */
export const ACCOUNT_ANALYTICS_PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok"] as const;

export type AccountAnalyticsSnapshot = {
  /** ISO timestamp we fetched. */
  fetchedAt: string;
  /** Normalized metrics per platform. */
  platforms: Record<string, AccountMetrics>;
  /** Ayrshare's own cache timestamp per platform. */
  lastUpdated: Record<string, string>;
};

export type RefreshAccountResult = {
  ok: boolean;
  platforms: number;
  error?: string;
  /** Set when the flag is off, so a caller can tell "disabled" from "failed". */
  skipped?: boolean;
};

/**
 * Fetch and store one account-analytics snapshot for a tenant.
 *
 * Deliberately does NOT fail the caller when a single platform is missing from
 * the response — a disconnected network should leave the other three's numbers
 * intact rather than blank the whole panel.
 */
export async function refreshAccountAnalytics(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<RefreshAccountResult> {
  if (!nativeSocialAnalyticsEnabled()) {
    return { ok: true, platforms: 0, skipped: true };
  }

  const apiKey = getAyrshareApiKey();
  if (!apiKey) return { ok: false, platforms: 0, error: "Ayrshare not configured" };

  const profileKey = (await getTenantConfig(tenantId)).ayrshareProfileKey;
  const result = await getAyrshareSocialAnalytics({
    apiKey,
    profileKey,
    platforms: [...ACCOUNT_ANALYTICS_PLATFORMS],
  });
  if (!result.ok) return { ok: false, platforms: 0, error: result.error };

  const snapshot: AccountAnalyticsSnapshot = {
    fetchedAt: new Date().toISOString(),
    platforms: result.perPlatform,
    lastUpdated: result.lastUpdated,
  };

  const { error } = await supabase
    .from("social_insights")
    .upsert({ tenant_id: tenantId, account_analytics: snapshot }, { onConflict: "tenant_id" });
  if (error) return { ok: false, platforms: 0, error: error.message };

  // Demographics are withheld below each platform's privacy threshold (Meta:
  // 100+ people per breakdown, surfaced as warning code 395). Log it once per
  // refresh so the blank Sections 5-6 in the report have a traceable reason.
  for (const [platform, metrics] of Object.entries(result.perPlatform)) {
    for (const w of metrics.warnings ?? []) {
      logger.info({ platform, code: w.code, detail: w.message }, "ayrshare account analytics warning");
    }
  }

  return { ok: true, platforms: Object.keys(result.perPlatform).length };
}
