/**
 * GET /api/images/list?limit=24
 *
 * Returns recent generated images so /content/images can show a gallery.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantDb } from "@/lib/tenant-db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "24");
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(limitRaw, 100))
    : 24;

  const sb = await getTenantDb();
  const { data, error } = await sb
    .from("generated_images")
    .select(
      "id, prompt, size, quality, storage_path, public_url, parent_image_id, created_at, metadata",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ images: data ?? [] });
}
