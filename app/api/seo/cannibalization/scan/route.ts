/**
 * POST /api/seo/cannibalization/scan
 * Body: { domain?: string }
 *
 * Pulls Semrush data, detects cannibalization, persists a snapshot, fires
 * alerts for high/medium severity issues, and returns the result.
 */

import { NextRequest, NextResponse } from "next/server";
import { detectCannibalization } from "@/lib/cannibalization";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const domain = (body?.domain as string | undefined) ?? undefined;
    const result = await detectCannibalization(domain);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
