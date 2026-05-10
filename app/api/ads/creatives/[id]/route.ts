/**
 * PATCH  /api/ads/creatives/[id]   — update a creative
 * DELETE /api/ads/creatives/[id]   — delete a creative
 */

import { NextRequest, NextResponse } from "next/server";

import { deleteAdCreative, updateAdCreative } from "@/lib/ads-store";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const creative = await updateAdCreative(id, body);
    return NextResponse.json({ creative });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update creative" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    await deleteAdCreative(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete creative" },
      { status: 500 },
    );
  }
}
