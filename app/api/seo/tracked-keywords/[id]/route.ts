/**
 * DELETE /api/seo/keywords/:id
 *
 * Removes a tracked keyword. Returns 204 on success, 404 if the keyword
 * doesn't exist.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantDb } from "@/lib/tenant-db";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const db = await getTenantDb();
    const { data, error } = await db
      .from("seo_keywords")
      .delete()
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[seo/keywords DELETE] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to delete keyword" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Keyword not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error("[seo/keywords DELETE] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to delete keyword" }, { status: 500 });
  }
}
