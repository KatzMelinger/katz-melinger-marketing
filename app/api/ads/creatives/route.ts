/**
 * GET  /api/ads/creatives        — list all creatives
 * POST /api/ads/creatives        — create a new creative
 */

import { NextRequest, NextResponse } from "next/server";

import {
  createAdCreative,
  listAdCreatives,
  type AdCreativeInput,
} from "@/lib/ads-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const creatives = await listAdCreatives();
    return NextResponse.json({ creatives });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list creatives" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body?.name || !body?.platform) {
      return NextResponse.json(
        { error: "name and platform are required" },
        { status: 400 },
      );
    }
    const input: AdCreativeInput = {
      name: String(body.name),
      platform: String(body.platform),
      format: body.format ?? null,
      practice_area: body.practice_area ?? null,
      headline: body.headline ?? null,
      description: body.description ?? null,
      body: body.body ?? null,
      cta: body.cta ?? null,
      visual_url: body.visual_url ?? null,
      notes: body.notes ?? null,
      status: body.status ?? "draft",
    };
    const creative = await createAdCreative(input);
    return NextResponse.json({ creative });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create creative" },
      { status: 500 },
    );
  }
}
