/**
 * GET  /api/images/style — return the saved brand image style.
 * POST /api/images/style — upsert a partial style update; returns the latest.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  IMAGE_STYLE_KEYS,
  loadImageStyle,
  saveImageStyle,
  type ImageStyleSettings,
} from "@/lib/image-style";

export const runtime = "nodejs";

export async function GET() {
  try {
    const style = await loadImageStyle();
    return NextResponse.json({ style });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "load failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Partial<ImageStyleSettings> = {};
  for (const key of IMAGE_STYLE_KEYS) {
    const v = body[key];
    if (typeof v === "string") patch[key] = v;
  }
  try {
    const style = await saveImageStyle(patch);
    return NextResponse.json({ style });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "save failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
