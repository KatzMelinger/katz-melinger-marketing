/**
 * POST /api/seo/backlinks/verify
 *   body: { url: string }
 *
 * Fetches the URL and reports whether it currently links to katzmelinger.com.
 * SSRF-protected — only public HTTP/HTTPS URLs are allowed.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyBacklinkFromUrl } from "@/lib/backlink-verify";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const url = (body?.url as string | undefined)?.trim();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  const result = await verifyBacklinkFromUrl(url);
  return NextResponse.json(result);
}
