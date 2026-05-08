/**
 * POST /api/ai-search/crawl
 *
 * Body: { url?: string }
 *
 * Runs an AI-readiness crawl against the given URL (defaults to katzmelinger.com).
 * Returns raw signals — robots.txt rules, schema markup, content shape, etc.
 * Pair with /api/ai-search/analyze to score the result via Claude.
 */

import { NextRequest, NextResponse } from "next/server";
import { runAICrawl } from "@/lib/ai-crawler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const url = typeof body?.url === "string" ? body.url : undefined;

    const result = await runAICrawl(url);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to crawl site";
    console.error("[ai-search/crawl] Failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
