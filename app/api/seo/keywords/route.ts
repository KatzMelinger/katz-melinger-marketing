import { NextRequest, NextResponse } from "next/server";

import { listCompetitors } from "@/lib/seo-competitors";
import {
  getKeywordGapVsCompetitor,
  getTrackedKeywordPerformance,
} from "@/lib/seo-intelligence";
import { SEMRUSH_DOMAIN } from "@/lib/semrush";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams;
    const competitor = search.get("competitor");
    const base = await getTrackedKeywordPerformance(SEMRUSH_DOMAIN);

    if (!competitor) {
      return NextResponse.json({
        domain: SEMRUSH_DOMAIN,
        competitors: listCompetitors(),
        ...base,
      });
    }

    const competitive = await getKeywordGapVsCompetitor(competitor, SEMRUSH_DOMAIN);
    return NextResponse.json({
      domain: SEMRUSH_DOMAIN,
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

