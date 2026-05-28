/**
 * GET    /api/content/site-inventory?pillar=&pageType=  — list the cluster map
 * PATCH  /api/content/site-inventory                    — override a page's pillar
 *          body: { id, pillar }
 */

import { NextRequest, NextResponse } from "next/server";

import {
  listSitePages,
  setSitePagePillar,
  type SitePageType,
} from "@/lib/site-inventory";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  try {
    const pages = await listSitePages({
      pillar: url.searchParams.get("pillar") ?? undefined,
      pageType:
        (url.searchParams.get("pageType") as SitePageType | null) ?? undefined,
    });
    return NextResponse.json({ pages });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    pillar?: unknown;
  };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const pillar = typeof body.pillar === "string" ? body.pillar : null;
  try {
    await setSitePagePillar(id, pillar);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 500 },
    );
  }
}
