/**
 * POST /api/seo/citations/audit
 *
 * Body: { text: string }
 *
 * Paste listing text pulled from one or more directory/citation sites; Claude
 * extracts each source's NAP and compares it to the firm's canonical NAP,
 * flagging inconsistencies. Returns findings only — the user saves the ones
 * they want via POST /api/seo/citations. No external API cost beyond Claude.
 */

import { NextRequest, NextResponse } from "next/server";

import { auditCitations } from "@/lib/seo-citations";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text : "";
    const result = await auditCitations(text);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Audit failed" },
      { status: 500 },
    );
  }
}
