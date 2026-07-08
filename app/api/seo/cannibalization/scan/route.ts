/**
 * POST /api/seo/cannibalization/scan
 * Body: { domain?: string }
 *
 * Pulls DataForSEO data, detects cannibalization, persists a snapshot, fires
 * alerts for high/medium severity issues, and returns the result.
 */

import { NextRequest, NextResponse } from "next/server";
import { detectCannibalization } from "@/lib/cannibalization";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
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
