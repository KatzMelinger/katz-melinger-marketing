import { NextRequest, NextResponse } from "next/server";

import { getTechnicalSeoMonitoring } from "@/lib/seo-intelligence";
import { SEMRUSH_DOMAIN } from "@/lib/semrush";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url") || `https://${SEMRUSH_DOMAIN}`;
  try {
    const data = await getTechnicalSeoMonitoring(url);
    return NextResponse.json({
      url,
      ...data,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed technical seo checks" },
      { status: 500 },
    );
  }
}

