/**
 * POST /api/content/video/render
 *   body: { draft_id: string, provider?: string, options?: object }
 *   Starts an async render of a video-script draft. Returns the video_renders
 *   row immediately (status "queued" | "rendering") — does NOT block on the
 *   render finishing. Poll GET /api/content/video/render/[id] for status.
 *
 * GET /api/content/video/render?draft_id=...
 *   Lists renders for a draft (newest first).
 */

import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_PROVIDER_ID,
  type RenderOptions,
} from "@/lib/video-providers";
import {
  listRendersForDraft,
  RenderError,
  startRender,
} from "@/lib/video-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    draft_id?: unknown;
    provider?: unknown;
    options?: unknown;
  };
  const draftId = typeof body.draft_id === "string" ? body.draft_id.trim() : "";
  if (!draftId) {
    return NextResponse.json({ error: "draft_id required" }, { status: 400 });
  }
  const providerId =
    typeof body.provider === "string" && body.provider.trim()
      ? body.provider.trim()
      : DEFAULT_PROVIDER_ID;
  const options =
    body.options && typeof body.options === "object"
      ? (body.options as RenderOptions)
      : {};

  try {
    const render = await startRender({ draftId, providerId, options });
    return NextResponse.json({ render }, { status: 201 });
  } catch (err) {
    if (err instanceof RenderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "Failed to start render";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const draftId = req.nextUrl.searchParams.get("draft_id")?.trim();
  if (!draftId) {
    return NextResponse.json({ error: "draft_id required" }, { status: 400 });
  }
  try {
    const renders = await listRendersForDraft(draftId);
    return NextResponse.json({ renders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list renders";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
