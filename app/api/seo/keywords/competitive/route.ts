import { NextRequest, NextResponse } from "next/server";

import { getKeywordGapVsCompetitor } from "@/lib/seo-intelligence";
import { getTenantConfig } from "@/lib/tenant-config";

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
    const { seoDomain } = await getTenantConfig();
    const opportunities = await getKeywordGapVsCompetitor(domain, seoDomain);
    return NextResponse.json({
      domain: seoDomain,
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

