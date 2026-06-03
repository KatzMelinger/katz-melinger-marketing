/**
 * GET /api/content/video/providers — list available render providers and
 * whether each is configured. Drives the provider picker in the render UI.
 */

import { NextResponse } from "next/server";

import { DEFAULT_PROVIDER_ID, listVideoProviders } from "@/lib/video-providers";

export const runtime = "nodejs";

export async function GET() {
  const providers = listVideoProviders().map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
  }));
  return NextResponse.json({ providers, default: DEFAULT_PROVIDER_ID });
}
