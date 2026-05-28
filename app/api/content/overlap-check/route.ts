/**
 * POST /api/content/overlap-check
 *   body: { terms: string[], excludeUrl?: string }
 *
 * Runs the content-overlap detector against the site_pages cluster map.
 * Used by the drafts analysis panel to flag glossary terms / sections that
 * duplicate an existing page ("link, don't redefine").
 */

import { NextRequest, NextResponse } from "next/server";

import { detectContentOverlap } from "@/lib/content-overlap";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    terms?: unknown;
    excludeUrl?: unknown;
  };
  const terms = Array.isArray(body.terms)
    ? (body.terms as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  if (terms.length === 0) {
    return NextResponse.json(
      { error: "terms (string[]) required" },
      { status: 400 },
    );
  }
  try {
    const result = await detectContentOverlap(terms, {
      excludeUrl:
        typeof body.excludeUrl === "string" ? body.excludeUrl : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "overlap check failed" },
      { status: 500 },
    );
  }
}
