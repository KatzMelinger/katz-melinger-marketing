/**
 * DELETE /api/ads/keywords/[id]  — remove a negative keyword
 */

import { NextRequest, NextResponse } from "next/server";

import { deleteNegativeKeyword } from "@/lib/ads-store";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    await deleteNegativeKeyword(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete keyword" },
      { status: 500 },
    );
  }
}
