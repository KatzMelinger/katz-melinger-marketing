/**
 * GET    /api/content/site-inventory?pillar=&pageType=  — list the cluster map
 * PATCH  /api/content/site-inventory                    — override a page's pillar,
 *          or set its content-refresh workflow status
 *          body: { id, pillar } | { id, refreshStatus }
 */

import { NextRequest, NextResponse } from "next/server";

import {
  listSitePages,
  setSitePagePillar,
  setSitePageRefreshStatus,
  type RefreshStatus,
  type SitePageType,
} from "@/lib/site-inventory";

const REFRESH_STATUSES: RefreshStatus[] = ["not_started", "in_progress", "updated"];

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
    refreshStatus?: unknown;
  };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (typeof body.refreshStatus === "string") {
    if (!REFRESH_STATUSES.includes(body.refreshStatus as RefreshStatus)) {
      return NextResponse.json({ error: "invalid refreshStatus" }, { status: 400 });
    }
    try {
      await setSitePageRefreshStatus(id, body.refreshStatus as RefreshStatus);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "update failed" },
        { status: 500 },
      );
    }
  }

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
