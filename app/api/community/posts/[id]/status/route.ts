/**
 * PATCH /api/community/posts/[id]/status
 *   body: { platform: "reddit" | "hackernews" | "news", status: "responded" | "skipped" | "starred" | "new", notes?: string }
 *
 * Mark a post in a specific platform's scan stream. Responded/skipped posts
 * will be filtered out of future scans by default; starred posts surface to
 * the top.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

const VALID_PLATFORMS = ["reddit", "hackernews", "news", "youtube"] as const;
const VALID_STATUSES = ["new", "responded", "skipped", "starred"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const platform = body?.platform as (typeof VALID_PLATFORMS)[number] | undefined;
  const status = body?.status as (typeof VALID_STATUSES)[number] | undefined;
  const notes = (body?.notes as string | undefined)?.trim() ?? null;

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "platform required" }, { status: 400 });
  }
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "status required" }, { status: 400 });
  }

  const { supabase, tenantId } = await getTenantClient();
  const { error } = await supabase.from("community_post_status").upsert(
    {
      platform,
      post_id: id,
      status,
      notes,
      marked_by: me.id,
      marked_at: new Date().toISOString(),
      tenant_id: tenantId,
    },
    { onConflict: "tenant_id,platform,post_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
