/**
 * /api/content/pillars
 *   GET — the live pillar list: { pillars: KMPillar[] } (DB or code fallback).
 *   PUT — replace the whole list. Body: { pillars: KMPillar[] }. Validates,
 *         normalizes ids to slugs, de-dupes by id, persists to
 *         tenant_settings.pillars.
 *
 * Backs the Brand Voice → Content pillars editor. The grouper, link plan,
 * cluster map, and brief read the same list via lib/pillars-store.getPillars().
 */

import { NextResponse } from "next/server";

import { getPillars, savePillars } from "@/lib/pillars-store";
import { normalizePillar, type KMPillar } from "@/lib/km-content-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PILLARS = 100;

export async function GET() {
  try {
    const pillars = await getPillars();
    return NextResponse.json({ pillars });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load pillars";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const raw = (body as { pillars?: unknown }).pillars;
  if (!Array.isArray(raw)) {
    return NextResponse.json(
      { error: "pillars must be an array" },
      { status: 400 },
    );
  }

  const cleaned: KMPillar[] = [];
  for (const item of raw) {
    const p = normalizePillar(item);
    if (p) cleaned.push(p);
    if (cleaned.length >= MAX_PILLARS) break;
  }
  if (cleaned.length === 0) {
    return NextResponse.json(
      { error: "at least one valid pillar (id, label, url) is required" },
      { status: 400 },
    );
  }

  try {
    const saved = await savePillars(cleaned);
    return NextResponse.json({ pillars: saved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save pillars";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
