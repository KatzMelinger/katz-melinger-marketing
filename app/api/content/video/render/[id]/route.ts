/**
 * GET    /api/content/video/render/[id] — poll a render's status. Polling this
 *        endpoint drives the job forward (it asks the provider for the latest
 *        state and persists any change), so the UI just polls until the status
 *        is "succeeded" or "failed".
 * DELETE /api/content/video/render/[id] — remove a render (and its stored file).
 */

import { NextRequest, NextResponse } from "next/server";

import { deleteRender, refreshRender, RenderError } from "@/lib/video-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const render = await refreshRender(id);
    if (!render) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ render });
  } catch (err) {
    if (err instanceof RenderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "Failed to fetch render";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await deleteRender(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete render";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
