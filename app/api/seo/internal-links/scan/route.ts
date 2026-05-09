/**
 * POST /api/seo/internal-links/scan
 * Body: { url?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { runInternalLinkAudit } from "@/lib/internal-link-audit";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const url = (body?.url as string | undefined) ?? "https://www.katzmelinger.com";
    const result = await runInternalLinkAudit(url);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
