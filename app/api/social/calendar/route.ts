/**
 * GET /api/social/calendar
 *
 * Feeds the Social Ops → Content Calendar screen. Reads the tenant's
 * social_posts (the table every scheduled/published post lands in, whether it
 * came from a blog splinter, a service-page post, or a manual marketing alert
 * pushed through the Ayrshare publish path) and returns a flat list the client
 * groups into the monthly grid and weekly time-slot views.
 *
 * Each item's calendar date is scheduled_at (for upcoming posts) falling back
 * to published_at, then created_at — so a post shows up on the day it is/was
 * meant to go live. Reads are RLS-scoped via getTenantDb.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type CalendarItem = {
  id: string;
  platform: string;
  body: string;
  status: string;
  /** The day this post is/was scheduled or published (ISO). */
  date: string;
  postUrl: string | null;
  sourceDraftId: string | null;
};

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  const db = await getTenantDb();

  const { data, error } = await db
    .from("social_posts")
    .select(
      "id, platform, content, status, scheduled_at, posted_at, published_at, created_at, post_url, source_draft_id",
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const items: CalendarItem[] = rows
    .map((r) => {
      const date =
        (r.scheduled_at as string | null) ??
        (r.published_at as string | null) ??
        (r.posted_at as string | null) ??
        (r.created_at as string | null);
      if (!date) return null;
      return {
        id: String(r.id ?? ""),
        platform: String(r.platform ?? "").toLowerCase(),
        body: typeof r.content === "string" ? r.content : "",
        status: String(r.status ?? "published"),
        date,
        postUrl: (r.post_url as string | null) ?? null,
        sourceDraftId: (r.source_draft_id as string | null) ?? null,
      } satisfies CalendarItem;
    })
    .filter((x): x is CalendarItem => x !== null);

  return NextResponse.json({ items });
}
