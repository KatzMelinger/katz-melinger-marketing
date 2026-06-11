import { NextRequest, NextResponse } from "next/server";

import { listCompetitors } from "@/lib/seo-competitors";
import {
  getKeywordGapVsCompetitor,
  getKeywordGapVsCompetitors,
  getTrackedKeywordPerformance,
} from "@/lib/seo-intelligence";
import { getTenantConfig } from "@/lib/tenant-config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { tenantId, semrushDomain } = await getTenantConfig();
    const search = request.nextUrl.searchParams;
    const competitor = search.get("competitor");
    const base = await getTrackedKeywordPerformance(semrushDomain, tenantId);

    if (!competitor) {
      return NextResponse.json({
        domain: semrushDomain,
        competitors: await listCompetitors(tenantId),
        ...base,
      });
    }

    // "all" → merged gap across the curated competitor set (the default the
    // page uses). A specific domain → single-competitor gap (backward compat).
    if (competitor === "all") {
      const competitors = await listCompetitors(tenantId);
      const competitive = await getKeywordGapVsCompetitors(competitors, semrushDomain);
      return NextResponse.json({
        domain: semrushDomain,
        competitors,
        ...base,
        competitive,
      });
    }

    const competitive = await getKeywordGapVsCompetitor(competitor, semrushDomain);
    return NextResponse.json({
      domain: semrushDomain,
      competitor,
      ...base,
      competitive,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed keyword lookup" },
      { status: 500 },
    );
  }
}

