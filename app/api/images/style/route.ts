/**
 * GET  /api/images/style — return the saved brand image style: the general
 *                          5-field guide plus per-channel notes.
 * POST /api/images/style — upsert either the general-guide fields (as before)
 *                          or a single channel's notes ({ channel, notes }).
 *                          Returns the latest { style, channels }.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  IMAGE_STYLE_KEYS,
  isStyleChannel,
  type ImageStyleSettings,
} from "@/lib/image-style";
import {
  loadChannelNotes,
  loadImageStyle,
  saveChannelNotes,
  saveImageStyle,
} from "@/lib/image-style-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [style, channels] = await Promise.all([
      loadImageStyle(),
      loadChannelNotes(),
    ]);
    return NextResponse.json({ style, channels });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "load failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Channel-notes update: { channel, notes }
  if (typeof body.channel === "string") {
    if (!isStyleChannel(body.channel)) {
      return NextResponse.json({ error: "invalid channel" }, { status: 400 });
    }
    const notes = typeof body.notes === "string" ? body.notes : "";
    try {
      const channels = await saveChannelNotes(body.channel, notes);
      const style = await loadImageStyle();
      return NextResponse.json({ style, channels });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "save failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // General-guide update: any of the IMAGE_STYLE_KEYS.
  const patch: Partial<ImageStyleSettings> = {};
  for (const key of IMAGE_STYLE_KEYS) {
    const v = body[key];
    if (typeof v === "string") patch[key] = v;
  }
  try {
    const [style, channels] = await Promise.all([
      saveImageStyle(patch),
      loadChannelNotes(),
    ]);
    return NextResponse.json({ style, channels });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "save failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
