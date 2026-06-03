/**
 * /api/practice-areas
 *   GET — return the live practice-area list: { areas: string[] } (ordered).
 *   PUT — replace the whole list. Body: { areas: string[] }. Trims, drops
 *         blanks, de-dupes case-insensitively, and stores in the given order.
 *
 * Backs the editor on /settings/practice-areas and is read by the Content
 * Studio dropdowns. Server-side generation reads the same list via
 * lib/practice-areas.getPracticeAreas().
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { DEFAULT_PRACTICE_AREAS, getPracticeAreas } from "@/lib/practice-areas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LABEL_LENGTH = 80;
const MAX_AREAS = 50;

export async function GET() {
  try {
    const areas = await getPracticeAreas();
    return NextResponse.json({ areas });
  } catch {
    return NextResponse.json({ areas: [...DEFAULT_PRACTICE_AREAS] });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = (body as { areas?: unknown }).areas;
  if (!Array.isArray(raw)) {
    return NextResponse.json(
      { error: "areas must be an array of strings" },
      { status: 400 },
    );
  }

  const seen = new Set<string>();
  const areas: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const label = item.trim();
    if (!label || label.length > MAX_LABEL_LENGTH) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    areas.push(label);
    if (areas.length >= MAX_AREAS) break;
  }
  if (areas.length === 0) {
    return NextResponse.json(
      { error: "at least one practice area is required" },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabaseAdmin();
    // Replace-all: clear then insert in order. Supabase requires a filter on
    // delete, so match every row via an impossible-id inequality.
    const { error: delErr } = await sb
      .from("practice_areas")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    const rows = areas.map((label, i) => ({ label, sort_order: i }));
    const { error: insErr } = await sb.from("practice_areas").insert(rows);
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    return NextResponse.json({ areas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save practice areas";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
