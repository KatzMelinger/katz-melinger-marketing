/**
 * POST /api/seo/directories/suggest
 *
 * Asks Claude which legal + business directories the firm should be listed on,
 * tailored to its practice areas and geography (from firm context). Returns
 * suggestions only — the user adds the ones they want via POST /api/seo/directories.
 * No external API cost beyond the Claude call.
 */

import { NextResponse } from "next/server";

import { suggestDirectories } from "@/lib/seo-directories";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const suggestions = await suggestDirectories();
    return NextResponse.json({ suggestions });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to suggest directories" },
      { status: 500 },
    );
  }
}
