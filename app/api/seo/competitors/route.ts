import { NextRequest, NextResponse } from "next/server";

import { addCompetitor, listCompetitors } from "@/lib/seo-competitors";
import { getOrganicCompetitors } from "@/lib/seo-intelligence";
import { SEMRUSH_DOMAIN } from "@/lib/semrush";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [semrushCompetitors, trackedDomains] = await Promise.all([
      getOrganicCompetitors(SEMRUSH_DOMAIN, 20),
      Promise.resolve(listCompetitors()),
    ]);

    return NextResponse.json({
      trackedDomains,
      semrushCompetitors,
      suggestedDomains: semrushCompetitors.slice(0, 8).map((item) => item.domain),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed competitor lookup" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const domain =
    body && typeof body === "object" && typeof (body as { domain?: unknown }).domain === "string"
      ? (body as { domain: string }).domain
      : "";

  const result = addCompetitor(domain);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "Invalid domain" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    added: result.domain,
    trackedDomains: listCompetitors(),
  });
}

