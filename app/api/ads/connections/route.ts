/**
 * GET /api/ads/connections — list every ad platform with current status.
 *
 * Pre-seeded with 5 platforms: Google Ads, Google LSA, Microsoft Ads, Meta,
 * LinkedIn. Initially all are 'not_connected'. When an OAuth flow is wired up
 * for a platform, this endpoint also reflects the connected state.
 */

import { NextResponse } from "next/server";

import { listPlatformAccounts } from "@/lib/ads-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const accounts = await listPlatformAccounts();
    return NextResponse.json({ accounts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load connections" },
      { status: 500 },
    );
  }
}
