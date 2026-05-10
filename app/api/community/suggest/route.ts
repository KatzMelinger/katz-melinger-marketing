/**
 * POST /api/community/suggest
 *   body: { platform: "reddit" | "quora" | "avvo", title: string, body?: string }
 *
 * Returns a Claude-generated suggested response in the requested platform's
 * etiquette and the firm's brand voice.
 */

import { NextRequest, NextResponse } from "next/server";
import { suggestResponse, type Platform } from "@/lib/community-suggester";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID: Platform[] = ["reddit", "quora", "avvo"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const platform = body?.platform as Platform | undefined;
  const title = (body?.title as string | undefined)?.trim();
  const text = (body?.body as string | undefined)?.trim();

  if (!platform || !VALID.includes(platform)) {
    return NextResponse.json({ error: "platform must be reddit|quora|avvo" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  try {
    const result = await suggestResponse({ platform, title, body: text });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Suggestion failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
