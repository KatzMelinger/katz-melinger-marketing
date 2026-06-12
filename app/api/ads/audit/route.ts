/**
 * POST /api/ads/audit
 *
 * Body: { report: string, platform?, reportType?, context? }
 *
 * The "no API required" account audit. The user exports a report from the ad
 * platform's own UI (search-terms, campaigns, ads, audience/placement) and
 * pastes/uploads the CSV. Claude returns a prioritized issue list plus
 * negative-keyword suggestions (search platforms only).
 *
 * Stateless — nothing is persisted. Suggested negatives are added to the
 * existing negative-keyword list only when the user clicks "Add" (which POSTs
 * to /api/ads/keywords with source "audit").
 */

import { NextRequest, NextResponse } from "next/server";

import { auditAdsReport } from "@/lib/ads-audit";
import { recordAdAudit } from "@/lib/ads-store";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const report = typeof body?.report === "string" ? body.report.trim() : "";
    if (!report) {
      return NextResponse.json({ error: "report is required" }, { status: 400 });
    }

    const platform =
      typeof body?.platform === "string" ? body.platform : "google_search";
    const reportType =
      typeof body?.reportType === "string" ? body.reportType : undefined;

    const result = await auditAdsReport({
      report,
      platform,
      reportType,
      context: typeof body?.context === "string" ? body.context : undefined,
    });

    // Best-effort: store the audit so it shows in history. Never fail the
    // request if Supabase is unreachable or the table isn't created yet.
    let auditId: string | null = null;
    try {
      const row = await recordAdAudit({
        platform,
        report_type: reportType ?? null,
        health_score: result.healthScore,
        issue_count: result.issues.length,
        neg_count: result.negativeKeywordSuggestions.length,
        summary: result.summary,
        result,
      });
      auditId = row.id;
    } catch (err) {
      console.warn("[ads/audit] history persistence failed:", err);
    }

    return NextResponse.json({ result, auditId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audit failed";
    console.error("[ads/audit] Failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
