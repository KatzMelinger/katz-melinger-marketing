/**
 * S13(d) — source-currency flag: when a social post is repurposed from a blog,
 * an outdated or time-sensitive source should be called out, so the social
 * caption doesn't quietly repeat a figure the source itself needs to update.
 * Advisory only — this attaches a finding, it never blocks (unlike S13(b)'s
 * open-findings hold). Reuses the same freshness machinery already gating
 * blog approval (app/api/agent/approve/route.ts), applied to the SOURCE
 * draft's body rather than the social caption.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { findTimeSensitiveFacts } from "./freshness-check";
import { classifyFreshness, unresolvedFreshness } from "./freshness-classify";
import { getCurrentFacts } from "./current-facts-store";

const STALE_MONTHS = 18;

export type SourceCurrencyFlag = {
  reason: "stale_age" | "time_sensitive_figure";
  detail: string;
  /** S13(c) — the firm's own page stating the correct value, when tracked. */
  siteUrl?: string;
};

/**
 * Checks the source blog draft's age and any time-sensitive figures in its
 * body. Returns null when the source is current or can't be checked (missing,
 * query error) — never throws, this must never block the caller.
 */
export async function checkSourceCurrency(
  sourceDraftId: string,
  tenantId?: string,
): Promise<SourceCurrencyFlag | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("content_drafts")
      .select("body, updated_at, created_at")
      .eq("id", sourceDraftId)
      .maybeSingle();
    if (!data) return null;

    const asOf = new Date((data.updated_at as string | null) ?? (data.created_at as string | null) ?? Date.now());
    const ageMonths = (Date.now() - asOf.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonths >= STALE_MONTHS) {
      return {
        reason: "stale_age",
        detail: `Source blog was last updated ${Math.round(ageMonths)} months ago (>${STALE_MONTHS}-month threshold) — verify it's still current before repurposing.`,
      };
    }

    const body = typeof data.body === "string" ? data.body : "";
    const facts = await getCurrentFacts(tenantId);
    const outstanding = unresolvedFreshness(classifyFreshness(findTimeSensitiveFacts(body), facts));
    if (outstanding.length > 0) {
      const citedUrl = outstanding.find((f) => f.site_url)?.site_url;
      return {
        reason: "time_sensitive_figure",
        detail: `Source blog carries ${outstanding.length} unresolved time-sensitive figure${
          outstanding.length === 1 ? "" : "s"
        } (e.g. "${outstanding[0].match}") — confirm it's still accurate before repurposing.${
          citedUrl ? ` See the correct value: ${citedUrl}` : ""
        }`,
        ...(citedUrl ? { siteUrl: citedUrl } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}
