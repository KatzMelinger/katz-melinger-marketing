/**
 * PATCH  /api/recommendations/items/[id]  — body: { status, notes? }
 * DELETE /api/recommendations/items/[id]  — remove permanently
 */

import { NextRequest, NextResponse } from "next/server";

import {
  deleteItem,
  type RecStatus,
  updateItemStatus,
} from "@/lib/recommendation-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: RecStatus[] = ["active", "done", "hold", "disregard"];

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const status = body?.status as string | undefined;
    if (!status || !VALID.includes(status as RecStatus)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID.join(", ")}` },
        { status: 400 },
      );
    }
    const notes =
      typeof body?.notes === "string" ? body.notes : body?.notes === null ? null : undefined;

    const updated = await updateItemStatus(id, status as RecStatus, notes);
    if (!updated) {
      return NextResponse.json({ error: "Not found or update failed" }, { status: 404 });
    }
    return NextResponse.json({ item: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update" },
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
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
    const ok = await deleteItem(id);
    if (!ok) return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete" },
      { status: 500 },
    );
  }
}
