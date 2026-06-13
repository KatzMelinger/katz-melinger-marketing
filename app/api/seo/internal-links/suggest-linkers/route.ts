/**
 * POST /api/seo/internal-links/suggest-linkers
 *
 * Body: { url: string } — an orphan page URL from the internal-link audit.
 *
 * Returns existing pages that already cover the orphan's topic and are the
 * natural place to add an inbound link, plus a suggested anchor text. See
 * lib/internal-links.ts#suggestOrphanLinkers.
 */

import { NextResponse } from "next/server";

import { suggestOrphanLinkers } from "@/lib/internal-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { url?: unknown };
  try {
    body = (await req.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const result = await suggestOrphanLinkers(url);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
