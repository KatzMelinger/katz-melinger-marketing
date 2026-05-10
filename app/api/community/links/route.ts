/**
 * GET /api/community/links?platform=quora|avvo
 *
 * Returns the curated launcher links for Quora or Avvo (those platforms
 * have bot protection so we can't scan them directly).
 */

import { NextRequest, NextResponse } from "next/server";
import { QUORA_LINKS, AVVO_LINKS, TIKTOK_LINKS } from "@/lib/community-scanner";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform");
  if (platform === "quora") return NextResponse.json({ links: QUORA_LINKS });
  if (platform === "avvo") return NextResponse.json({ links: AVVO_LINKS });
  if (platform === "tiktok") return NextResponse.json({ links: TIKTOK_LINKS });
  return NextResponse.json({ error: "platform must be quora|avvo|tiktok" }, { status: 400 });
}
