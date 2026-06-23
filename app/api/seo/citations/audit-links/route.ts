/**
 * POST /api/seo/citations/audit-links
 *
 * Audits every saved citation that has a listing_url by fetching the link and
 * AI-checking its NAP against canonical — no pasting. Updates each row in place.
 * Sites that block bots come back "unverified" with a note to paste that one.
 * Companion to /api/seo/citations/audit (the paste-based audit).
 */

import { NextResponse } from "next/server";

import { auditCitationsByLinks } from "@/lib/seo-citations";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    const result = await auditCitationsByLinks();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Audit failed" },
      { status: 500 },
    );
  }
}
