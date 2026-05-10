/**
 * GET /api/community/statuses?platform=reddit
 *
 * Returns a map of { post_id: status } for the requested platform so the
 * scanner page can decorate scan results with their saved status.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

const VALID_PLATFORMS = ["reddit", "hackernews", "news"] as const;

export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform");
  if (!platform || !VALID_PLATFORMS.includes(platform as (typeof VALID_PLATFORMS)[number])) {
    return NextResponse.json({ error: "platform required" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("community_post_status")
    .select("post_id, status, notes, marked_at")
    .eq("platform", platform);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const map: Record<string, { status: string; notes: string | null; marked_at: string }> = {};
  for (const row of data ?? []) {
    map[row.post_id as string] = {
      status: row.status as string,
      notes: (row.notes as string | null) ?? null,
      marked_at: row.marked_at as string,
    };
  }
  return NextResponse.json({ statuses: map });
}
