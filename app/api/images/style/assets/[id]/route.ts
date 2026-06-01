/**
 * DELETE /api/images/style/assets/[id] — remove one uploaded design reference
 * (storage object + table row).
 */

import { NextResponse } from "next/server";

import { deleteStyleAsset } from "@/lib/image-style-assets";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  try {
    await deleteStyleAsset(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
