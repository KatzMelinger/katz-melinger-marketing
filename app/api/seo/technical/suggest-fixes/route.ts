/**
 * POST /api/seo/technical/suggest-fixes
 *   body: { url: string }
 *
 * Snapshots the page's on-page SEO state and asks Claude for concrete
 * AutoPilot-shaped fixes. Returns the snapshot + suggested fixes. The
 * marketer reviews them on /seo/technical, then POSTs the ones they
 * accept to /api/seo/technical/queue-fixes which inserts them into the
 * AutoPilot queue.
 */

import { NextRequest, NextResponse } from "next/server";

import { analyzePageForFixes } from "@/lib/technical-fix-analyzer";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (!raw) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return NextResponse.json({ error: "http(s) only" }, { status: 400 });
  }
  try {
    const result = await analyzePageForFixes(url.toString());
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
