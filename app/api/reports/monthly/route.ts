/**
 * GET /api/reports/monthly
 *
 * The SEO-side assembly for spec 4.3's monthly report (F1) — keyword/backlink/
 * technical data (lib/monthly-report.ts) plus the content-pipeline stage
 * counts. GA4, AEO, and AI-bot-crawl data are deliberately NOT included here:
 * app/reports/page.tsx fetches those from their own existing endpoints
 * directly, the same way every other page in this app composes several data
 * sources, rather than this route re-implementing integrations it doesn't own.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import { getSeoReportData, getPipelineCounts } from "@/lib/monthly-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  const tenantId = await resolveTenantId();
  try {
    const [seo, pipeline] = await Promise.all([
      getSeoReportData(tenantId),
      getPipelineCounts(tenantId),
    ]);
    return NextResponse.json({ seo, pipeline, generatedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to assemble report" },
      { status: 500 },
    );
  }
}
