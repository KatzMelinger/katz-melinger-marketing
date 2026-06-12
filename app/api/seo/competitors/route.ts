/**
 * GET    /api/seo/competitors             — tracked + Semrush-suggested
 * POST   /api/seo/competitors             — body: { domain, source? }
 * DELETE /api/seo/competitors?domain=…    — remove a tracked competitor
 */

import { NextRequest, NextResponse } from "next/server";

import { addCompetitor, listCompetitors, removeCompetitor } from "@/lib/seo-competitors";
import { getOrganicCompetitors } from "@/lib/seo-intelligence";
import { getTenantConfig } from "@/lib/tenant-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { tenantId, semrushDomain } = await getTenantConfig();
    const [semrushCompetitors, trackedDomains] = await Promise.all([
      getOrganicCompetitors(semrushDomain, 20),
      listCompetitors(tenantId),
    ]);

    const trackedSet = new Set(trackedDomains);
    const suggestedFromSemrush = semrushCompetitors.map((c) => ({
      ...c,
      tracked: trackedSet.has(c.domain),
    }));

    return NextResponse.json({
      trackedDomains,
      semrushCompetitors,
      suggestedFromSemrush,
      // Legacy field kept for backwards compatibility.
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
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const domain = typeof obj.domain === "string" ? obj.domain : "";
  const source = obj.source === "suggested" ? "suggested" : "manual";

  const result = await addCompetitor(domain, source);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Invalid domain" }, { status: 400 });
  }

  const trackedDomains = await listCompetitors();
  return NextResponse.json({ ok: true, added: result.domain, trackedDomains });
}

export async function DELETE(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain") ?? "";
  const result = await removeCompetitor(domain);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  const trackedDomains = await listCompetitors();
  return NextResponse.json({ ok: true, removed: result.domain, trackedDomains });
}
