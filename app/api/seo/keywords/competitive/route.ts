import { NextRequest, NextResponse } from "next/server";

import { getKeywordGapVsCompetitor } from "@/lib/seo-intelligence";
import { SEMRUSH_DOMAIN } from "@/lib/semrush";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain");
  if (!domain) {
    return NextResponse.json(
      { error: "domain query parameter is required" },
      { status: 400 },
    );
  }

  try {
    const opportunities = await getKeywordGapVsCompetitor(domain, SEMRUSH_DOMAIN);
    return NextResponse.json({
      domain: SEMRUSH_DOMAIN,
      competitor: domain,
      opportunities,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch keyword battle data" },
      { status: 500 },
    );
  }
}

