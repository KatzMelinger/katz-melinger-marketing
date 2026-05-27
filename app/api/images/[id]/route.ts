/**
 * DELETE /api/images/[id]
 *
 * Removes the storage object + DB row. Used by the gallery's delete button on
 * /content/images.
 */

import { NextRequest, NextResponse } from "next/server";
import { deleteSavedImage } from "@/lib/image-store";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  try {
    await deleteSavedImage(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
