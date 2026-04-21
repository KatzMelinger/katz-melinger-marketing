import { NextRequest, NextResponse } from "next/server";

import { listCompetitors } from "@/lib/seo-competitors";
import {
  getBacklinkDomains,
  getKeywordGapVsCompetitor,
  getTrackedKeywordPerformance,
} from "@/lib/seo-intelligence";
import { SEMRUSH_DOMAIN } from "@/lib/semrush";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const competitor = request.nextUrl.searchParams.get("competitor");
    const tracked = await getTrackedKeywordPerformance(SEMRUSH_DOMAIN);
    const domains = listCompetitors();
    const selectedCompetitor = competitor || domains[0] || "";
    const [gaps, backlinks] = await Promise.all([
      selectedCompetitor ? getKeywordGapVsCompetitor(selectedCompetitor, SEMRUSH_DOMAIN) : [],
      getBacklinkDomains(SEMRUSH_DOMAIN),
    ]);

    const topLinkGaps = backlinks
      .filter((row) => row.authorityScore >= 45)
      .slice(0, 8)
      .map((row) => ({
        domain: row.domain,
        opportunity: "High authority referring domain not fully leveraged.",
      }));

    return NextResponse.json({
      selectedCompetitor,
      competitors: domains,
      quickWins: gaps.slice(0, 12),
      missingTargetKeywords: tracked.missingTargets,
      longTailSuggestions: tracked.longTailSuggestions,
      topLinkGaps,
      summary: {
        keywordQuickWins: gaps.filter((row) => row.opportunityScore >= 70).length,
        toxicLinksToDisavow: backlinks.filter((row) => row.toxicityRisk === "high").length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed seo opportunities" },
      { status: 500 },
    );
  }
}

