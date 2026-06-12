/**
 * /api/ads/competitor-ads — paid-ad competitor intelligence (Layer 0).
 *
 * POST { competitors?: string[] }
 *   Pulls each competitor's LIVE Google ads (DataForSEO SERP API → Transparency Center)
 *   through the quota-gated usage meter, then has Claude synthesize the
 *   competitive landscape + recommendations. Best-effort snapshot per scan.
 *   Returns { results, strategy, usage, quotaExceeded, providerNotConfigured }.
 *
 * GET — current month's usage meter for the tab to display on load.
 *
 * Quota and provider-config problems are returned as friendly flags (200), not
 * 500s, so the tab can render a clear notice instead of an error.
 */

import { NextRequest, NextResponse } from "next/server";

import { listCompetitors } from "@/lib/seo-competitors";
import { resolveTenantId } from "@/lib/tenant-context";
import {
  COMPETITOR_LOOKUP_METER,
  DataForSeoNotConfiguredError,
  QuotaExceededError,
  type CompetitorAdResult,
  fetchLiveCompetitorAds,
  recordCompetitorSnapshot,
  synthesizeCompetitorStrategy,
} from "@/lib/competitor-ads";
import { getUsageSummary } from "@/lib/usage-meter";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tenantId = await resolveTenantId();
    const usage = await getUsageSummary(tenantId, COMPETITOR_LOOKUP_METER);
    return NextResponse.json({ usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load usage";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await resolveTenantId();
    const body = await req.json().catch(() => ({}));

    // Resolve the competitor set: explicit list, else the tenant's tracked list.
    const requested = Array.isArray(body?.competitors)
      ? body.competitors.filter((d: unknown): d is string => typeof d === "string" && d.trim().length > 0)
      : [];
    const competitors = requested.length > 0 ? requested : await listCompetitors(tenantId);

    if (competitors.length === 0) {
      return NextResponse.json({
        results: [],
        strategy: null,
        usage: await getUsageSummary(tenantId, COMPETITOR_LOOKUP_METER),
        quotaExceeded: false,
        providerNotConfigured: false,
        message: "No competitors are being tracked yet. Add competitors in the SEO module first.",
      });
    }

    const results: CompetitorAdResult[] = [];
    let quotaExceeded = false;

    for (const domain of competitors) {
      try {
        const result = await fetchLiveCompetitorAds({ tenantId, competitorDomain: domain });
        results.push(result);
        await recordCompetitorSnapshot(tenantId, result);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          quotaExceeded = true;
          break; // stop early — don't fire any more billable calls
        }
        if (err instanceof DataForSeoNotConfiguredError) {
          return NextResponse.json({
            results: [],
            strategy: null,
            usage: await getUsageSummary(tenantId, COMPETITOR_LOOKUP_METER),
            quotaExceeded: false,
            providerNotConfigured: true,
            message:
              "Ad-data provider is not configured. Set DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD to enable live competitor ad lookups.",
          });
        }
        // A single competitor failing (e.g. transient DataForSEO error) shouldn't
        // sink the whole scan — skip it and continue.
        console.warn(`[ads/competitor-ads] lookup failed for ${domain}:`, err);
      }
    }

    // Synthesize only when we actually pulled something.
    let strategy = null;
    if (results.length > 0) {
      try {
        strategy = await synthesizeCompetitorStrategy(results, tenantId);
      } catch (err) {
        console.warn("[ads/competitor-ads] synthesis failed:", err);
      }
    }

    return NextResponse.json({
      results,
      strategy,
      usage: await getUsageSummary(tenantId, COMPETITOR_LOOKUP_METER),
      quotaExceeded,
      providerNotConfigured: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Competitor scan failed";
    console.error("[ads/competitor-ads] Failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
