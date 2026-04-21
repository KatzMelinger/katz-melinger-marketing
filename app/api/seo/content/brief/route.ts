import { NextRequest, NextResponse } from "next/server";

import { listCompetitors } from "@/lib/seo-competitors";
import { buildContentSeoBrief } from "@/lib/seo-intelligence";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const topic = request.nextUrl.searchParams.get("topic")?.trim() ?? "";
  const practiceArea = request.nextUrl.searchParams.get("practice_area")?.trim() ?? "";
  if (!topic) {
    return NextResponse.json(
      { error: "topic query param is required" },
      { status: 400 },
    );
  }

  try {
    const brief = await buildContentSeoBrief({
      topic,
      practiceArea,
      competitorDomains: listCompetitors(),
    });
    return NextResponse.json(brief);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed seo brief generation" },
      { status: 500 },
    );
  }
}

